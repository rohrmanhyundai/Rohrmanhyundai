import React, { useRef, useEffect } from 'react';
import { badgeCls } from '../utils/formatters';

const SPEED = 55; // pixels per second

function TickerStrip({ label, items }) {
  const contentRef = useRef(null);
  const animRef = useRef({ x: 0, last: null, raf: null });

  useEffect(() => {
    const el = contentRef.current;
    if (!el || !items.length) return;

    const a = animRef.current;
    a.x = 0;
    a.last = null;
    el.style.transform = 'translateX(0px)';

    function tick(ts) {
      if (!a.last) a.last = ts;
      const dt = Math.min(ts - a.last, 100); // cap so tab-restore doesn't jump
      a.last = ts;

      const half = el.scrollWidth / 2;
      if (half > 0) {
        a.x += SPEED * dt / 1000;
        if (a.x >= half) a.x -= half;
        el.style.transform = `translateX(${-a.x}px)`;
      }
      a.raf = requestAnimationFrame(tick);
    }

    a.raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(a.raf);
      a.last = null;
    };
  }, [items]);

  const doubled = [...items, ...items];

  return (
    <div className="ticker-strip">
      <div className="ticker-label">{label}</div>
      <div className="ticker-track">
        {items.length === 0 ? (
          <span className="ticker-item" style={{ padding: '0 12px', color: 'var(--muted)' }}>—</span>
        ) : (
          <div className="ticker-content" ref={contentRef}>
            {doubled.map((item, i) => (
              <React.Fragment key={i}>
                {item}
                <span className="ticker-sep">&bull;</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
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
      <TickerStrip label="Training Center" items={trainingItems} />
      <TickerStrip label="Vacation Approved" items={vacationItems} />
    </div>
  );
}
