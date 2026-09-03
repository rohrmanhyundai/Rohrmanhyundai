import React from 'react';

// Chooser that sits between the dashboard button and the two request forms.
// Techline additional time and additional diag time are different asks with
// different proof, so they get their own forms instead of one form with a
// mode switch a tech has to notice.
export default function AdditionalTimeMenu({
  currentUser, currentUserDisplay, onBack, onTechline, onDiag, onViewMine,
}) {
  const cards = [
    {
      onClick: onTechline,
      icon: '☎️',
      label: 'Submit Tech Line Additional Time',
      sub: 'You called Techline and have a case number',
      bg: 'linear-gradient(135deg,rgba(251,191,36,.22),rgba(245,158,11,.14))',
      border: 'rgba(251,191,36,.5)',
      color: '#fbbf24',
    },
    {
      onClick: onDiag,
      icon: '⏱️',
      label: 'Submit Additional Diag Time',
      sub: 'You need more diagnosis time on a repair order',
      bg: 'linear-gradient(135deg,rgba(192,132,252,.22),rgba(147,51,234,.14))',
      border: 'rgba(192,132,252,.5)',
      color: '#c084fc',
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0d1627', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '16px 14px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18 }}>
        <div>
          <div style={{ color: '#c084fc', fontWeight: 800, fontSize: 18 }}>Warranty Additional Time</div>
          <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 2 }}>{currentUserDisplay || currentUser}</div>
        </div>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
          ← Back
        </button>
      </div>

      <div style={{ color: '#7a92b8', fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
        Pick what you're requesting.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {cards.map(c => (
          <button
            key={c.label}
            onClick={c.onClick}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
              width: '100%', background: c.bg, border: `1px solid ${c.border}`,
              borderRadius: 14, padding: '18px 16px', cursor: 'pointer',
            }}>
            <span style={{ fontSize: 30, flexShrink: 0 }}>{c.icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', color: c.color, fontWeight: 800, fontSize: 16, lineHeight: 1.3 }}>{c.label}</span>
              <span style={{ display: 'block', color: '#94a3b8', fontSize: 12.5, marginTop: 4, lineHeight: 1.4 }}>{c.sub}</span>
            </span>
            <span style={{ color: c.color, fontSize: 20, flexShrink: 0 }}>›</span>
          </button>
        ))}
      </div>

      {onViewMine && (
        <button onClick={onViewMine}
          style={{ width: '100%', marginTop: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.13)', color: '#94a3b8', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          View my submitted times
        </button>
      )}
    </div>
  );
}
