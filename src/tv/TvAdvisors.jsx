// Advisor Performance for the shop TV dashboard — same numbers and goals as
// the main dashboard's table (components/AdvisorPerformance.jsx), laid out as
// one row of tiles per advisor so it reads like the tech boxes above it.
import React from 'react';
import { n, pct, safe } from '../utils/formatters';
import { advisorDailyAverage, advisorsForDisplay, advisorMonthStarted, roh50Goals } from '../utils/calculations';

// Tile colors: at goal → green, within 85% → yellow, else red. Values are
// rounded to what's printed first, so "25.0%" never shows red against 25%.
const GREEN = '#4ade80', YELLOW = '#fde047', RED = '#f87171';
function tone(val, goal, dec) {
  if (!(goal > 0)) return '#e2e8f0';
  const v = Number(safe(val, 0).toFixed(dec));
  return v >= goal ? GREEN : v / goal >= 0.85 ? YELLOW : RED;
}

export default function TvAdvisors({ data }) {
  const started = advisorMonthStarted();
  const advisors = advisorsForDisplay(data).filter(a => !a.hidden);
  const sum = started ? (data.advisorSummary || {}) : {};
  const r50 = roh50Goals(data);

  // [label, field, goal, decimals for the color check, format, goal label]
  const METRICS = [
    ['Hrs / RO', 'hours_per_ro', 1.4, 2, v => n(v, 2), '1.4'],
    ['Alignment', 'align', 0.10, 3, v => pct(v, 1), '10%'],
    ['Tires', 'tires', 0.15, 3, v => pct(v, 1), '15%'],
    ['Valvoline', 'valvoline', 0.25, 3, v => pct(v, 1), '25%'],
    ['$50 Add’l Hrs', 'roh50_hrs_ro', r50.hrs_ro, 2, v => n(v, 2), r50.hrs_ro > 0 ? n(r50.hrs_ro, 2) : '—'],
    ['$50 Add Rate', 'roh50_add_rate', r50.add_rate, 3, v => pct(v, 1), r50.add_rate > 0 ? pct(r50.add_rate, 0) : '—'],
    ['CSI', 'csi', 910, 0, v => String(Math.round(safe(v))), '910'],
    ['ASR', 'asr', 0.21, 3, v => pct(v, 1), '21%'],
    ['ELR', 'elr', 0.88, 2, v => pct(v, 0), '88%'],
  ];

  const avgs = [
    ['Align', pct(sum.align, 1), started ? tone(sum.align, 0.10, 3) : '#94a3b8'],
    ['Tires', pct(sum.tires, 1), started ? tone(sum.tires, 0.15, 3) : '#94a3b8'],
    ['Valvoline', pct(sum.valvoline, 1), started ? tone(sum.valvoline, 0.25, 3) : '#94a3b8'],
    ['CSI', Math.round(safe(sum.csi)).toString(), started ? tone(sum.csi, 910, 0) : '#94a3b8'],
  ];

  return (
    <section className="card tvd-advs">
      <div className="tvd-head">
        <div className="title">Advisor Performance</div>
        <div className="note">Snapshot {started ? (data.advisorSummary && data.advisorSummary.date) || '—' : '—'} · updated one day behind</div>
        <div style={{ flex: 1 }} />
        {avgs.map(([k, v, c]) => (
          <div className="tvd-avg" key={k}>Shop {k} <b style={{ color: c }}>{v}</b></div>
        ))}
      </div>
      <div className="tvd-adv-list" style={{ gridTemplateRows: `repeat(${Math.max(1, advisors.length)}, minmax(0, 1fr))` }}>
        {advisors.map(a => {
          const out = !!a.exclude_from_avg;
          return (
            <div className="tvd-adv" key={a.name}>
              <div className="tvd-adv-who">
                <div className="nm">
                  {a.name}
                  {out && <span className="tag" title="Ramping up — not counted in the shop averages">NOT IN AVG</span>}
                </div>
                <div className="avg">{n(advisorDailyAverage(a, data), 2)}<span> hrs/day</span></div>
                <div className="sub">MTD <b>{n(a.mtd_hours, 1)}</b> · Last mo <b>{n(a.last_month_total, 1)}</b></div>
              </div>
              <div className="tvd-adv-tiles">
                {METRICS.map(([label, key, goal, dec, fmt, goalLabel]) => {
                  const c = out ? '#e2e8f0' : tone(a[key], goal, dec);
                  const hit = !out && c === GREEN;
                  return (
                    <div className={`tvd-mt${hit ? ' hit' : ''}`} key={key} style={{ borderColor: out ? undefined : `${c}55` }}>
                      <div className="lbl">{label}</div>
                      <div className="val" style={{ color: c }}>{fmt(a[key])}</div>
                      <div className="goal">goal {goalLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
