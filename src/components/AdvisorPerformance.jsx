import React, { useEffect, useState } from 'react';
import { n, pct, safe } from '../utils/formatters';
import { advisorDailyAverage, advisorsForDisplay, advisorMonthStarted } from '../utils/calculations';

const BASE_FONT = 15; // baseline td font size
const BASE_ROWS = 3;  // baseline number of advisors

export default function AdvisorPerformance({ data }) {
  const [fontSize, setFontSize] = useState(BASE_FONT);

  // Before the month has started (reported a day behind), read empty instead of
  // carrying last month's totals.
  const started = advisorMonthStarted();
  const visibleAdvisors = advisorsForDisplay(data).filter(a => !a.hidden);
  const sum = started ? (data.advisorSummary || {}) : {};

  useEffect(() => {
    const count = visibleAdvisors.length || BASE_ROWS;
    const scale = Math.min(1, BASE_ROWS / count);
    setFontSize(Math.round(BASE_FONT * scale * 10) / 10);
  }, [visibleAdvisors.length]);

  const chips = [
    ['Snapshot', started ? data.advisorSummary.date : '—'],
    ['Align', pct(sum.align, 1)],
    ['Tires', pct(sum.tires, 1)],
    ['Valvoline', pct(sum.valvoline, 1)],
  ];

  // Column minimums (goals) paired with the decimals the cell rounds to. A value
  // under its goal gets the pulsing "perf-low" highlight to draw the eye on the
  // TV. Rounding first keeps the highlight honest with what's on screen: 0.2496
  // prints as "25.0%", which reads as meeting a 25% goal, so it must not flag.
  // MTD Hrs is excluded on purpose — it's a cumulative monthly goal, so it's
  // always "under" mid-month.
  const G = {
    hpr:   [1.4,  2],
    align: [0.10, 3],
    tires: [0.15, 3],
    valv:  [0.25, 3],
    roh50: [1.2,  2],
    csi:   [910,  0],
    asr:   [0.21, 3],
    elr:   [0.88, 2],
  };
  const under = (val, [goal, dec]) => Number(safe(val, 0).toFixed(dec)) < goal;
  const low = (val, goal) => (under(val, goal) ? 'perf-low' : undefined);
  // An advisor held out of the averages isn't being measured yet, so don't
  // pulse their whole row red on the TV for missing goals they don't have.
  const lowFor = (a, val, goal) => (a.exclude_from_avg ? undefined : low(val, goal));

  // Same minimums as the per-advisor columns. Only flag once the month has
  // started (before that `sum` is empty and everything reads 0).
  const kpis = [
    ['Avg Alignments', pct(sum.align, 1),     started && under(sum.align, G.align)],
    ['Avg Tires',      pct(sum.tires, 1),      started && under(sum.tires, G.tires)],
    ['Avg Valvoline',  pct(sum.valvoline, 1),  started && under(sum.valvoline, G.valv)],
    ['Avg CSI',        Math.round(safe(sum.csi)).toString(), started && under(sum.csi, G.csi)],
  ];

  const thStyle = { fontSize: Math.round(fontSize * 0.85) };
  const goalStyle = { color: '#95a9c6', fontSize: Math.round(fontSize * 0.7) };
  const tdStyle = { fontSize, padding: `${Math.max(3, fontSize * 0.35)}px 8px` };

  return (
    <section className="card">
      <div className="panel-head">
        <div>
          <div className="title">Advisor Performance</div>
          <div className="note">Daily Avg = MTD Hrs &divide; completed workdays. You update one day behind, so completed workdays means workdays before today.</div>
        </div>
        <div className="chips">
          {chips.map(([k, v]) => (
            <div className="chip" key={k}>{k} {v}</div>
          ))}
        </div>
      </div>
      <div className="tableArea" style={{ height: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={thStyle}>Advisor</th>
              <th style={thStyle}>Daily Avg</th>
              <th style={thStyle}>MTD Hrs<br /><span style={goalStyle}>Goal 300</span></th>
              <th style={thStyle}>Hrs/RO<br /><span style={goalStyle}>Goal 1.4</span></th>
              <th style={thStyle}>Alignment %<br /><span style={goalStyle}>Goal 10%</span></th>
              <th style={thStyle}>Tires %<br /><span style={goalStyle}>Goal 15%</span></th>
              <th style={thStyle}>Valvoline %<br /><span style={goalStyle}>Goal 25%</span></th>
              <th style={thStyle}>Roh$50 HRS/RO<br /><span style={goalStyle}>Goal 1.2</span></th>
              <th style={thStyle}>CSI<br /><span style={goalStyle}>Goal 910</span></th>
              <th style={thStyle}>ASR %<br /><span style={goalStyle}>Goal 21%</span></th>
              <th style={thStyle}>ELR %<br /><span style={goalStyle}>Goal 88%</span></th>
              <th style={thStyle}>Last Month Total</th>
            </tr>
          </thead>
          <tbody>
            {visibleAdvisors.map(a => (
              <tr key={a.name}>
                <td className="name" style={tdStyle}>
                  {a.name}
                  {a.exclude_from_avg && (
                    <span title="Ramping up — shown here, but not counted in the shop averages"
                      style={{ marginLeft: 7, fontSize: Math.round(fontSize * 0.55), fontWeight: 800, letterSpacing: .4, color: '#7dd3fc', background: 'rgba(56,189,248,.14)', border: '1px solid rgba(56,189,248,.32)', borderRadius: 5, padding: '1px 5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      NOT IN AVG
                    </span>
                  )}
                </td>
                <td style={tdStyle}>{n(advisorDailyAverage(a, data), 2)}</td>
                <td style={tdStyle}>{n(a.mtd_hours, 1)}</td>
                <td className={lowFor(a, a.hours_per_ro, G.hpr)} style={tdStyle}>{n(a.hours_per_ro, 2)}</td>
                <td className={lowFor(a, a.align, G.align)} style={tdStyle}>{pct(a.align, 1)}</td>
                <td className={lowFor(a, a.tires, G.tires)} style={tdStyle}>{pct(a.tires, 1)}</td>
                <td className={lowFor(a, a.valvoline, G.valv)} style={tdStyle}>{pct(a.valvoline, 1)}</td>
                <td className={lowFor(a, a.roh50_hrs_ro, G.roh50)} style={tdStyle}>{n(a.roh50_hrs_ro, 2)}</td>
                <td className={lowFor(a, a.csi, G.csi)} style={tdStyle}>{Math.round(safe(a.csi)).toString()}</td>
                <td className={lowFor(a, a.asr, G.asr)} style={tdStyle}>{pct(a.asr, 1)}</td>
                <td className={lowFor(a, a.elr, G.elr)} style={tdStyle}>{pct(a.elr, 0)}</td>
                <td style={tdStyle}>{n(a.last_month_total, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kpi-row">
        {kpis.map(([k, v, low]) => (
          <div className={`kpi${low ? ' kpi-low' : ''}`} key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
