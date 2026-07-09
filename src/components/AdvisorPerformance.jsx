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

  // Same minimums as the per-advisor columns. Only flag once the month has
  // started (before that `sum` is empty and everything reads 0).
  const kpis = [
    ['Avg Alignments', pct(sum.align, 1),     started && safe(sum.align, 0)     < 0.10],
    ['Avg Tires',      pct(sum.tires, 1),      started && safe(sum.tires, 0)     < 0.15],
    ['Avg Valvoline',  pct(sum.valvoline, 1),  started && safe(sum.valvoline, 0) < 0.25],
    ['Avg CSI',        Math.round(safe(sum.csi)).toString(), started && safe(sum.csi, 0) < 910],
  ];

  const thStyle = { fontSize: Math.round(fontSize * 0.85) };
  const goalStyle = { color: '#95a9c6', fontSize: Math.round(fontSize * 0.7) };
  const tdStyle = { fontSize, padding: `${Math.max(3, fontSize * 0.35)}px 8px` };

  // Column minimums (goals). A value under its goal gets the pulsing "perf-low"
  // highlight to draw the eye on the TV. MTD Hrs is excluded on purpose — it's a
  // cumulative monthly goal, so it's always "under" mid-month.
  const G = { hpr: 1.4, align: 0.10, tires: 0.15, valv: 0.25, roh50: 1.2, csi: 910, asr: 0.21, elr: 0.88 };
  const low = (val, goal) => (safe(val, 0) < goal ? 'perf-low' : undefined);

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
                <td className="name" style={tdStyle}>{a.name}</td>
                <td style={tdStyle}>{n(advisorDailyAverage(a, data), 2)}</td>
                <td style={tdStyle}>{n(a.mtd_hours, 1)}</td>
                <td className={low(a.hours_per_ro, G.hpr)} style={tdStyle}>{n(a.hours_per_ro, 2)}</td>
                <td className={low(a.align, G.align)} style={tdStyle}>{pct(a.align, 1)}</td>
                <td className={low(a.tires, G.tires)} style={tdStyle}>{pct(a.tires, 1)}</td>
                <td className={low(a.valvoline, G.valv)} style={tdStyle}>{pct(a.valvoline, 1)}</td>
                <td className={low(a.roh50_hrs_ro, G.roh50)} style={tdStyle}>{n(a.roh50_hrs_ro, 2)}</td>
                <td className={low(a.csi, G.csi)} style={tdStyle}>{Math.round(safe(a.csi)).toString()}</td>
                <td className={low(a.asr, G.asr)} style={tdStyle}>{pct(a.asr, 1)}</td>
                <td className={low(a.elr, G.elr)} style={tdStyle}>{pct(a.elr, 0)}</td>
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
