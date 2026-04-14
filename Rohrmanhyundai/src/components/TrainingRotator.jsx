import React, { useState, useEffect } from 'react';
import { badgeCls } from '../utils/formatters';

export default function TrainingRotator({ data, vacations }) {
  const [showTraining, setShowTraining] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setShowTraining(prev => !prev), 15000);
    return () => clearInterval(id);
  }, []);

  const title = showTraining ? 'Training Center' : 'Vacation Approved';
  const note = showTraining
    ? 'Columns: Certified, Training Due, Excel Training'
    : 'Rotates with Training Center every 15 seconds';

  return (
    <div className="card">
      <div className="panel-head">
        <div>
          <div className="title">{title}</div>
          <div className="note">{note}</div>
        </div>
        <div className="chips">
          <div className="chip">{title}</div>
          <div className="chip">Techs: {data.technicians?.length || 0}</div>
        </div>
      </div>

      <div className="rotatorShell">
        <div className={`rotatorPanel ${showTraining ? 'active' : ''}`}>
          <div className="trainingGrid">
            <div className="inner">
              <div className="innerTitle">Technicians</div>
              <div className="tableArea">
                <table>
                  <thead><tr><th>Name</th><th>Certified</th><th>Training Due</th><th>Excel Training</th></tr></thead>
                  <tbody>
                    {(data.technicians || []).map(t => {
                      const certified = t.certified || '\u2014';
                      const due = t.trainings_due || '\u2014';
                      const excel = t.excel_training || t.excel || '\u2014';
                      return (
                        <tr key={t.name}>
                          <td className="name">{t.name || '\u2014'}</td>
                          <td className="center"><span className={`badge ${badgeCls(certified)}`}>{certified}</span></td>
                          <td className="center"><span className="badge neutral">{due}</span></td>
                          <td className="center"><span className="badge neutral">{excel}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="inner">
              <div className="innerTitle">Advisors</div>
              <div className="tableArea">
                <table>
                  <thead><tr><th>Name</th><th>Certified</th><th>Training Due</th><th>Excel Training</th></tr></thead>
                  <tbody>
                    {(data.advisorTraining || []).map(a => {
                      const certified = a.certified || '\u2014';
                      const due = a.trainings_due || '\u2014';
                      const excel = a.excel_training || a.excel || '\u2014';
                      return (
                        <tr key={a.name}>
                          <td className="name">{a.name || '\u2014'}</td>
                          <td className="center"><span className={`badge ${badgeCls(certified)}`}>{certified}</span></td>
                          <td className="center"><span className="badge neutral">{due}</span></td>
                          <td className="center"><span className="badge neutral">{excel}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className={`rotatorPanel ${!showTraining ? 'active' : ''}`}>
          <div className="inner" style={{ height: '100%' }}>
            <div className="innerTitle">Approved Vacation</div>
            <div className="tableArea">
              <table>
                <thead><tr><th>Name</th><th>Dates</th><th>Status</th></tr></thead>
                <tbody>
                  {(vacations || []).map((v, i) => (
                    <tr key={i}>
                      <td className="name">{v.name || '\u2014'}</td>
                      <td>{v.dates || '\u2014'}</td>
                      <td className="center"><span className="badge neutral">{v.status || '\u2014'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
