import React from 'react';

export default function ATDiagWorksheet({ onBack, onDCTMTM, onIVT, backLabel = '← Technician Resources' }) {
  const cards = [
    {
      onClick: onDCTMTM,
      icon: '⚙️',
      label: 'DCT & MTM Diagnosis Worksheet',
      sub: 'Remanufactured DCT & MTM Core Return',
      bg: 'linear-gradient(135deg,rgba(251,191,36,.25),rgba(245,158,11,.18))',
      border: 'rgba(251,191,36,.45)',
      color: '#fbbf24',
      subColor: '#92400e',
    },
    {
      onClick: onIVT,
      icon: '🔧',
      label: 'IVT Core Diagnosis Worksheet',
      sub: 'Remanufactured IVT Core Return',
      bg: 'linear-gradient(135deg,rgba(99,179,237,.25),rgba(66,153,225,.18))',
      border: 'rgba(99,179,237,.45)',
      color: '#63b3ed',
      subColor: '#1e3a5f',
    },
  ];

  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <div>
          <div className="adv-title">⚙️ AT Diag Worksheet</div>
          <div className="adv-sub">Automatic Transmission Diagnosis Worksheets</div>
        </div>
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '40px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <p style={{ color: '#7a92b8', margin: 0, fontSize: 15 }}>Select a worksheet below.</p>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          {cards.map(card => (
            <button
              key={card.label}
              onClick={card.onClick}
              style={{
                width: 260, minHeight: 160,
                background: card.bg,
                border: `2px solid ${card.border}`,
                borderRadius: 18, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
                padding: 28, transition: 'transform .15s, border-color .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <span style={{ fontSize: 42 }}>{card.icon}</span>
              <span style={{ fontWeight: 800, fontSize: 15, color: card.color, textAlign: 'center' }}>
                {card.label}
              </span>
              <span style={{ fontSize: 11, color: card.subColor, textAlign: 'center' }}>
                {card.sub}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
