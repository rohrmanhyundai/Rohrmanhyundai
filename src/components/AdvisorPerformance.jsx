import React, { useEffect, useState } from 'react';
import { n, pct, safe } from '../utils/formatters';
import { advisorDailyAverage } from '../utils/calculations';

const BASE_FONT = 15; // baseline td font size
const BASE_ROWS = 3;  // baseline number of advisors

export default function AdvisorPerformance({ data }) {
  const [fontSize, setFontSize] = useState(BASE_FONT);

  useEffect(() => {
    const count = data.advisors.length || BASE_ROWS;
    const scale = Math.min(1, BASE_ROWS / count);
    setFontSize(Math.round(BASE_FONT * scale * 10) / 10);
  }, [data.advisors.length]);

  const chips = [
    ['Snapshot', data.advisorSummary.date],
    ['Align', pct(data.advisorSummary.align, 1)],
    ['Tires', pct(data.advisorSummary.tires, 1)],
    ['Valvoline', pct(data.advisorSummary.valvoline, 1)],
  ];

  const kpis = [
    ['Avg Alignments', pct(data.advisorSummary.align, 1)],
    ['Avg Tires', pct(data.advisorSummary.tires, 1)],
    ['Avg Valvoline', pct(data.advisorSummary.valvoline, 1)],
    ['Avg CSI', Math.round(safe(data.advisorSummary.csi)).toString()],
  ];

  const thStyle = { fontSize: Math.round(fontSize * 0.85) };
  const goalStyle = { color: '#95a9c6', fontSize: Math.round(fontSize * 0.7) };
  const tdStyle = { fontSize, padding: `${Math.max(3, fontSize * 0.35)}px 8px` };

  return (
    <section className="card">
      <div className="panel-head">
        <div>
          <div className="title">Advisor Performance</div>
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
              <th style={thStyle}>CSI<br /><span style={goalStyle}>Goal 920</span></th>
              <th style={thStyle}>ASR %<br /><span style={goalStyle}>Goal 21%</span></th>
              <th style={thStyle}>ELR %<br /><span style={goalStyle}>Goal 88%</span></th>
              <th style={thStyle}>Last Month Total</th>
            </tr>
          </thead>
          <tbody>
            {data.advisors.map(a => (
              <tr key={a.name}>
                <td className="name" style={tdStyle}>{a.name}</td>
                <td style={tdStyle}>{n(advisorDailyAverage(a, data), 2)}</td>
                <td style={tdStyle}>{n(a.mtd_hours, 1)}</td>
                <td style={tdStyle}>{n(a.hours_per_ro, 2)}</td>
                <td style={tdStyle}>{pct(a.align, 1)}</td>
                <td style={tdStyle}>{pct(a.tires, 1)}</td>
                <td style={tdStyle}>{pct(a.valvoline, 1)}</td>
                <td style={tdStyle}>{n(a.roh50_hrs_ro, 2)}</td>
                <td style={tdStyle}>{Math.round(safe(a.csi)).toString()}</td>
                <td style={tdStyle}>{pct(a.asr, 1)}</td>
                <td style={tdStyle}>{pct(a.elr, 0)}</td>
                <td style={tdStyle}>{n(a.last_month_total, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kpi-row">
        {kpis.map(([k, v]) => (
          <div className="kpi" key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
