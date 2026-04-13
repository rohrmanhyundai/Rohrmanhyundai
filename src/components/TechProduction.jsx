import React from 'react';
import { n, pct, safe } from '../utils/formatters';

export default function TechProduction({ data }) {
  const dayChips = [
    ['Mon', 'mon'], ['Tue', 'tue'], ['Wed', 'wed'],
    ['Thu', 'thu'], ['Fri', 'fri'], ['Sat', 'sat'],
  ];

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
      <div className="tableArea">
        <table>
          <thead>
            <tr>
              <th>Tech</th><th>Goal</th><th>Mon</th><th>Tue</th><th>Wed</th>
              <th>Thu</th><th>Fri</th><th>Sat</th><th>Total</th><th>Goal %</th><th>Pacing</th>
            </tr>
          </thead>
          <tbody>
            {data.technicians.map(t => {
              const width = Math.max(0, Math.min(100, safe(t.goal_pct) * 100));
              const cls = safe(t.goal_pct) >= 0.9 ? 'good' : safe(t.goal_pct) >= 0.75 ? 'warn' : 'bad';
              return (
                <tr key={t.name}>
                  <td className="name">{t.name}</td>
                  <td>{n(t.goal, 1)}</td>
                  <td>{n(t.mon, 1)}</td>
                  <td>{n(t.tue, 1)}</td>
                  <td>{n(t.wed, 1)}</td>
                  <td>{n(t.thu, 1)}</td>
                  <td>{n(t.fri, 1)}</td>
                  <td>{n(t.sat, 1)}</td>
                  <td>{n(t.total, 1)}</td>
                  <td>
                    <div>{pct(t.goal_pct, 0)}</div>
                    <div className="bar"><div className="fill" style={{ width: `${width}%` }} /></div>
                  </td>
                  <td><span className={`badge ${cls}`}>{n(t.pacing, 1)} hrs</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
