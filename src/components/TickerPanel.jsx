import React, { useRef, useEffect } from 'react';
import { badgeCls } from '../utils/formatters';

const SPEED = 55; // pixels per second

// `speed` (px/s) and `inline` (label beside the track, no card) are used by
// the shop TV dashboard; the main dashboard uses the defaults.
export function TickerStrip({ label, items, speed = SPEED, inline = false }) {
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
        a.x += speed * dt / 1000;
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
  }, [items, speed]);

  const doubled = [...items, ...items];

  return (
    <div className={`ticker-strip${inline ? ' ticker-strip--inline' : ''}`}>
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

const hiddenAdvisorsOf = (data) => new Set(
  (data.advisors || []).filter(a => a.hidden).map(a => a.name.toUpperCase())
);

export function vacationItemsFor(data, vacations) {
  const hiddenAdvisors = hiddenAdvisorsOf(data);
  return (vacations || [])
    .filter(v => !hiddenAdvisors.has((v.name || '').toUpperCase()))
    .map(v => (
      <span className="ticker-item" key={`v-${v.name}-${v.dates}`}>
        <span className="ticker-name">{v.name || '\u2014'}</span>
        <span>{v.dates || '\u2014'}</span>
        <span className="badge neutral">{v.status || '\u2014'}</span>
      </span>
    ));
}

// `show` lets the TV dashboard render just one strip ('training' |
// 'vacation'); the main dashboard shows both.
export default function TickerPanel({ data, vacations, show = 'both' }) {
  const hiddenAdvisors = hiddenAdvisorsOf(data);

  const trainingItems = [
    ...(data.technicians || []).map(t => (
      <span className="ticker-item" key={`t-${t.name}`}>
        <span className="ticker-name">{t.name}</span>
        <span className={`badge ${badgeCls(t.certified)}`}>{t.certified || '\u2014'}</span>
        <span style={{ color: '#95a9c6', fontSize: 11 }}>Training:</span>
        <span className="badge neutral">{t.trainings_due || '\u2014'}</span>
      </span>
    )),
    ...(data.advisorTraining || [])
      .filter(a => !hiddenAdvisors.has(a.name.toUpperCase()))
      .map(a => (
        <span className="ticker-item" key={`a-${a.name}`}>
          <span className="ticker-name">{a.name}</span>
          <span className={`badge ${badgeCls(a.certified)}`}>{a.certified || '\u2014'}</span>
          <span style={{ color: '#95a9c6', fontSize: 11 }}>Training:</span>
          <span className="badge neutral">{a.trainings_due || '\u2014'}</span>
        </span>
      )),
  ];

  const vacationItems = vacationItemsFor(data, vacations);

  return (
    <div className="ticker-section">
      {show !== 'vacation' && <TickerStrip label="Training Center" items={trainingItems} />}
      {show !== 'training' && <TickerStrip label="Vacation Approved" items={vacationItems} />}
    </div>
  );
}
