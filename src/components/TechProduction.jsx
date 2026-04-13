import React, { useRef, useEffect, useState } from 'react';
import { n, pct, safe } from '../utils/formatters';

const CONTAINER_H = 290; // approximate usable height for rows (340px card - header/th)
const BASE_FONT = 15;

export default function TechProduction({ data }) {
  const containerRef = useRef(null);
  const tableRef = useRef(null);
  const [fontSize, setFontSize] = useState(BASE_FONT);

  useEffect(() => {
    const count = data.technicians.length || 7;
    // Each row needs ~font*2.4 for text + padding + border
    const maxFont = Math.floor(CONTAINER_H / (count * 2.4));
    setFontSize(Math.min(BASE_FONT, Math.max(10, maxFont)));
  }, [data.technicians.length]);

  const dayChips = [
    ['Mon', 'mon'], ['Tue', 'tue'], ['Wed', 'wed'],
    ['Thu', 'thu'], ['Fri', 'fri'], ['Sat', 'sat'],
  ];

  const thStyle = { fontSize: Math.round(fontSize * 0.85) };
  const tdStyle = { fontSize, padding: `${Math.max(3, fontSize * 0.35)}px 8px` };

  return (
    <div className="card">
      <div className="panel-head">
        <div>
          <div className="title">Technician Production</div>
          <div className="note">Daily hours, totals, and pacing</div>
        </div>
        <div className="chips">
          {dayChips.map(([label, key]) => (
            <div className="chip" key={key}>{label} {n(data.techTotals[key], 1)}</div>
          ))}
        </div>
      </div>
      <div className="tableArea" ref={containerRef}>
        <table ref={tableRef}>
          <thead>
            <tr>
              <th style={thStyle}>Tech</th><th style={thStyle}>Goal</th><th style={thStyle}>Mon</th><th style={thStyle}>Tue</th><th style={thStyle}>Wed</th>
              <th style={thStyle}>Thu</th><th style={thStyle}>Fri</th><th style={thStyle}>Sat</th><th style={thStyle}>Total</th><th style={thStyle}>Goal %</th><th style={thStyle}>Pacing</th>
            </tr>
          </thead>
          <tbody>
            {data.technicians.map(t => {
              const width = Math.max(0, Math.min(100, safe(t.goal_pct) * 100));
              const cls = safe(t.goal_pct) >= 0.9 ? 'good' : safe(t.goal_pct) >= 0.75 ? 'warn' : 'bad';
              return (
                <tr key={t.name}>
                  <td className="name" style={tdStyle}>{t.name}</td>
                  <td style={tdStyle}>{n(t.goal, 1)}</td>
                  <td style={tdStyle}>{n(t.mon, 1)}</td>
                  <td style={tdStyle}>{n(t.tue, 1)}</td>
                  <td style={tdStyle}>{n(t.wed, 1)}</td>
                  <td style={tdStyle}>{n(t.thu, 1)}</td>
                  <td style={tdStyle}>{n(t.fri, 1)}</td>
                  <td style={tdStyle}>{n(t.sat, 1)}</td>
                  <td style={tdStyle}>{n(t.total, 1)}</td>
                  <td style={tdStyle}>
                    <div>{pct(t.goal_pct, 0)}</div>
                    <div className="bar"><div className="fill" style={{ width: `${width}%` }} /></div>
                  </td>
                  <td style={tdStyle}><span className={`badge ${cls}`} style={{ fontSize: Math.round(fontSize * 0.8) }}>{n(t.pacing, 1)} hrs</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
