import React from 'react';

export default function EmployeeReviewHub({ onBack, onTechReview, onAdvisorReview, currentUser }) {
  const cards = [
    {
      onClick: onTechReview,
      icon: '🔧',
      label: 'Technician Reviews',
      desc: 'View and manage technician performance reviews',
      bg: 'linear-gradient(135deg,rgba(251,146,60,.28),rgba(249,115,22,.18))',
      border: 'rgba(251,146,60,.45)',
      color: '#fdba74',
    },
    {
      onClick: onAdvisorReview,
      icon: '💼',
      label: 'Advisor Reviews',
      desc: 'View and manage service advisor performance reviews',
      bg: 'linear-gradient(135deg,rgba(99,179,237,.28),rgba(66,153,225,.18))',
      border: 'rgba(99,179,237,.45)',
      color: '#93c5fd',
    },
  ];

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">⭐ Employee Review</div>
          <div className="adv-sub">{currentUser}</div>
        </div>
        <button className="secondary" onClick={onBack}>← Manager Hub</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '40px 48px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>

          {/* Banner */}
          <div style={{ background: 'linear-gradient(135deg,rgba(236,72,153,.12),rgba(219,39,119,.07))', border: '1px solid rgba(236,72,153,.25)', borderRadius: 16, padding: '24px 32px', marginBottom: 40, display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: 48 }}>⭐</div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 22, color: '#f9a8d4', marginBottom: 4 }}>Employee Review</div>
              <div style={{ color: '#64748b', fontSize: 14 }}>Bob Rohrman Hyundai — Performance Reviews</div>
            </div>
          </div>

          {/* Cards */}
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
            {cards.map(card => (
              <button
                key={card.label}
                onClick={card.onClick}
                style={{
                  width: 300, minHeight: 180,
                  background: card.bg,
                  border: `2px solid ${card.border}`,
                  borderRadius: 20, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
                  padding: 32, transition: 'transform .15s, box-shadow .15s',
                  textAlign: 'center',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.35)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
              >
                <span style={{ fontSize: 48 }}>{card.icon}</span>
                <span style={{ fontWeight: 900, fontSize: 18, color: card.color }}>{card.label}</span>
                <span style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{card.desc}</span>
              </button>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
