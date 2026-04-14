import React from 'react';
import { safe } from '../utils/formatters';
import { buildGaugeData } from '../utils/calculations';
import quotes from '../data/quotes';

function gaugeSvg(g) {
  const p = Math.max(0, Math.min(1.2, safe(g.pct, 0)));
  const angle = Math.PI * (1 - p / 1.2);
  const x = 110 + 78 * Math.cos(angle);
  const y = 98 - 78 * Math.sin(angle);
  const color = p >= 1 ? '#22c55e' : p >= 0.9 ? '#f59e0b' : '#ef4444';
  const total = Math.PI * 78;
  const prog = total * (p / 1.2);

  return (
    <svg viewBox="0 0 220 130" className="gsvg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3dd6c3" />
          <stop offset="100%" stopColor="#6ee7f9" />
        </linearGradient>
      </defs>
      <path d="M 32 98 A 78 78 0 0 1 188 98" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="14" strokeLinecap="round" />
      <path d="M 32 98 A 78 78 0 0 1 188 98" fill="none" stroke="url(#grad)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${prog} ${total}`} />
      <line x1="110" y1="98" x2={x} y2={y} stroke={color} strokeWidth="6" strokeLinecap="round" />
      <circle cx="110" cy="98" r="8" fill={color} />
      <text x="32" y="116" fill="#8fa7c8" fontSize="10" textAnchor="middle">0%</text>
      <text x="110" y="16" fill="#8fa7c8" fontSize="10" textAnchor="middle">60%</text>
      <text x="188" y="116" fill="#8fa7c8" fontSize="10" textAnchor="middle">120%</text>
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
