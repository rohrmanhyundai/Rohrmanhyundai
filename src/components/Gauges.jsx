import React from 'react';
import { safe } from '../utils/formatters';
import { buildGaugeData } from '../utils/calculations';
import quotes from '../data/quotes';

function gaugeSvg(g) {
  const p = Math.max(0, Math.min(1.2, safe(g.pct, 0)));
  const angle = Math.PI * (1 - p / 1.2);
  const x = 110 + 78 * Math.cos(angle);
  const y = 98 - 78 * Math.sin(angle);
  // Performance status color — drives the needle, hub and the bright tail of
  // the arc so red/amber/green is still readable at a glance on the TV.
  const status = p >= 1 ? '#2bf5a8' : p >= 0.9 ? '#ffc24d' : '#ff4d7d';
  const total = Math.PI * 78;
  const prog = total * (p / 1.2);
  // Unique id suffix per gauge so gradient/filter defs don't collide when
  // several gauges render in the same document.
  const uid = 'g' + String(g.label || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

  return (
    <svg viewBox="0 0 220 130" className="gsvg">
      <defs>
        <linearGradient id={uid + 'arc'} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="42%" stopColor="#6366f1" />
          <stop offset="72%" stopColor="#a855f7" />
          <stop offset="100%" stopColor={status} />
        </linearGradient>
        <radialGradient id={uid + 'hub'} cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={status} />
        </radialGradient>
        <filter id={uid + 'glow'} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* track */}
      <path d="M 32 98 A 78 78 0 0 1 188 98" fill="none" stroke="rgba(148,163,184,.16)" strokeWidth="14" strokeLinecap="round" />
      {/* glowing progress arc */}
      <path d="M 32 98 A 78 78 0 0 1 188 98" fill="none" stroke={`url(#${uid}arc)`} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${prog} ${total}`} filter={`url(#${uid}glow)`} />
      <text x="32" y="116" fill="#8fa7c8" fontSize="10" textAnchor="middle">0%</text>
      <text x="110" y="16" fill="#8fa7c8" fontSize="10" textAnchor="middle">60%</text>
      <text x="188" y="116" fill="#8fa7c8" fontSize="10" textAnchor="middle">120%</text>
      {/* needle + glowing hub */}
      <line x1="110" y1="98" x2={x} y2={y} stroke={status} strokeWidth="5" strokeLinecap="round" filter={`url(#${uid}glow)`} />
      <circle cx="110" cy="98" r="9" fill={`url(#${uid}hub)`} />
      <circle cx="110" cy="98" r="9" fill="none" stroke={status} strokeWidth="1.5" opacity=".9" />
    </svg>
  );
}

function getDailyQuote() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  return quotes[dayOfYear % quotes.length];
}

export default function Gauges({ data }) {
  const gauges = buildGaugeData(data);
  const quote = getDailyQuote();

  return (
    <section className="card">
      <div className="panel-head">
        <div>
          <div className="title">Performance Gauges</div>
          <div className="note">Needle = percent to goal. Big number = projected monthly hours.</div>
        </div>
      </div>
      <div className="gauges">
        {gauges.map(g => (
          <div className="gcard" key={g.label}>
            <div className="gtitle">{g.label}</div>
            {gaugeSvg(g)}
            <div className="gmain">{g.main}</div>
            <div className="gsub">{g.sub}</div>
          </div>
        ))}
        <div className="quote-card">
          <div className="quote-icon">&#x201C;</div>
          {(() => {
            const fs = Math.max(13, Math.min(24, Math.floor(380 / Math.max(1, quote.text.length) * 10)));
            return (
              <>
                <div className="quote-text" style={{ fontSize: fs }}>{quote.text}</div>
                <div className="quote-author" style={{ fontSize: fs }}>&mdash; {quote.author}</div>
              </>
            );
          })()}
        </div>
      </div>
    </section>
  );
}
