import React from 'react';
import { badgeCls } from '../utils/formatters';

function TickerItems({ items }) {
  // Duplicate items for seamless infinite scroll
  return (
    <div className="ticker-content">
      {[...items, ...items].map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="ticker-sep">&bull;</span>}
          {item}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function TickerPanel({ data, vacations }) {
  const trainingItems = [
    ...(data.technicians || []).map(t => (
      <span className="ticker-item" key={`t-${t.name}`}>
        <span className="ticker-name">{t.name}</span>
        <span className={`badge ${badgeCls(t.certified)}`}>{t.certified || '\u2014'}</span>
        <span style={{ color: '#95a9c6', fontSize: 11 }}>Training:</span>
        <span className="badge neutral">{t.trainings_due || '\u2014'}</span>
        <span style={{ color: '#95a9c6', fontSize: 11 }}>Excel:</span>
        <span className="badge neutral">{t.excel_training || t.excel || '\u2014'}</span>
      </span>
    )),
    ...(data.advisorTraining || []).map(a => (
      <span className="ticker-item" key={`a-${a.name}`}>
        <span className="ticker-name">{a.name}</span>
        <span className={`badge ${badgeCls(a.certified)}`}>{a.certified || '\u2014'}</span>
        <span style={{ color: '#95a9c6', fontSize: 11 }}>Training:</span>
        <span className="badge neutral">{a.trainings_due || '\u2014'}</span>
        <span style={{ color: '#95a9c6', fontSize: 11 }}>Excel:</span>
        <span className="badge neutral">{a.excel_training || a.excel || '\u2014'}</span>
      </span>
    )),
  ];

  const vacationItems = (vacations || []).map(v => (
    <span className="ticker-item" key={`v-${v.name}-${v.dates}`}>
      <span className="ticker-name">{v.name || '\u2014'}</span>
      <span>{v.dates || '\u2014'}</span>
      <span className="badge neutral">{v.status || '\u2014'}</span>
    </span>
  ));

  return (
    <div className="ticker-section">
      <div className="ticker-strip">
        <div className="ticker-label">Training Center</div>
        <div className="ticker-track">
          <TickerItems items={trainingItems} />
        </div>
      </div>
      <div className="ticker-strip">
        <div className="ticker-label">Vacation Approved</div>
        <div className="ticker-track">
          <TickerItems items={vacationItems} />
        </div>
      </div>
    </div>
  );
}
