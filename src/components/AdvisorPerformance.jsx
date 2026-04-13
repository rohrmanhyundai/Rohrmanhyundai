import React from 'react';
import { n, pct, safe } from '../utils/formatters';
import { advisorDailyAverage } from '../utils/calculations';

export default function AdvisorPerformance({ data }) {
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
              <th>Advisor</th>
              <th>Daily Avg</th>
              <th>MTD Hrs<br /><span style={{ color: '#95a9c6', fontSize: '10px' }}>Goal 300</span></th>
              <th>Hrs/RO<br /><span style={{ color: '#95a9c6', fontSize: '10px' }}>Goal 1.4</span></th>
              <th>Alignment %<br /><span style={{ color: '#95a9c6', fontSize: '10px' }}>Goal 10%</span></th>
              <th>Tires %<br /><span style={{ color: '#95a9c6', fontSize: '10px' }}>Goal 15%</span></th>
              <th>Valvoline %<br /><span style={{ color: '#95a9c6', fontSize: '10px' }}>Goal 25%</span></th>
              <th>Roh$50 HRS/RO<br /><span style={{ color: '#95a9c6', fontSize: '10px' }}>Goal 1.2</span></th>
              <th>CSI<br /><span style={{ color: '#95a9c6', fontSize: '10px' }}>Goal 920</span></th>
              <th>ASR %<br /><span style={{ color: '#95a9c6', fontSize: '10px' }}>Goal 21%</span></th>
              <th>ELR %<br /><span style={{ color: '#95a9c6', fontSize: '10px' }}>Goal 88%</span></th>
              <th>Last Month Total</th>
            </tr>
          </thead>
          <tbody>
            {data.advisors.map(a => (
              <tr key={a.name}>
                <td className="name">{a.name}</td>
                <td>{n(advisorDailyAverage(a, data), 2)}</td>
                <td>{n(a.mtd_hours, 1)}</td>
                <td>{n(a.hours_per_ro, 2)}</td>
                <td>{pct(a.align, 1)}</td>
                <td>{pct(a.tires, 1)}</td>
                <td>{pct(a.valvoline, 1)}</td>
                <td>{n(a.roh50_hrs_ro, 2)}</td>
                <td>{Math.round(safe(a.csi)).toString()}</td>
                <td>{pct(a.asr, 1)}</td>
                <td>{pct(a.elr, 0)}</td>
                <td>{n(a.last_month_total, 1)}</td>
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
