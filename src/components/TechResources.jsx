import React from 'react';

function canSee(pages, role, key) {
  if (role === 'admin' || (role || '').includes('manager')) return true;
  if (!pages) return true;
  return pages[key] !== false;
}

const NAV_BUTTONS = [
  {
    key: 'techSchedule',
    label: '📅 Technician Work Schedule',
    bg: 'linear-gradient(135deg,rgba(167,139,250,.25),rgba(139,92,246,.18))',
    border: 'rgba(167,139,250,.45)',
    color: '#c4b5fd',
    prop: 'onWorkSchedule',
  },
  {
    key: 'advisorSchedule',
    label: '🗓 Advisor Work Schedule',
    bg: 'linear-gradient(135deg,rgba(61,214,195,.25),rgba(110,231,249,.18))',
    border: 'rgba(61,214,195,.45)',
    color: '#6ee7f9',
    prop: 'onAdvisorSchedule',
  },
  {
    key: 'documentLibrary',
    label: '📁 Document Library',
    bg: 'linear-gradient(135deg,rgba(110,231,249,.25),rgba(61,214,195,.18))',
    border: 'rgba(110,231,249,.45)',
    color: '#6ee7f9',
    prop: 'onDocumentLibrary',
  },
  {
    key: 'workInProgress',
    label: '🔧 Work in Progress',
    bg: 'linear-gradient(135deg,rgba(251,146,60,.25),rgba(249,115,22,.18))',
    border: 'rgba(251,146,60,.45)',
    color: '#fb923c',
    prop: 'onWorkInProgress',
  },
  {
    key: 'tireQuote',
    label: '🛞 Tire Quote',
    bg: 'linear-gradient(135deg,rgba(74,222,128,.25),rgba(34,197,94,.18))',
    border: 'rgba(74,222,128,.45)',
    color: '#4ade80',
    href: 'https://hyundaitirecenter.com/InitDealer?dealer=IN007',
  },
];

export default function TechResources({ currentUser, currentRole, userPages, onWorkSchedule, onAdvisorSchedule, onDocumentLibrary, onWorkInProgress, onBack }) {
  const handlers = { onWorkSchedule, onAdvisorSchedule, onDocumentLibrary, onWorkInProgress };
  const visible = NAV_BUTTONS.filter(b => canSee(userPages, currentRole, b.key));

  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <div>
          <div className="adv-title">Technician Resources</div>
          <div className="adv-sub">{currentUser}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={onBack}>← Service Operations Dashboard</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '40px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <p style={{ color: '#7a92b8', margin: 0, fontSize: 15 }}>Select a resource below.</p>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          {visible.map(btn => (
            <button
              key={btn.key}
              onClick={btn.href ? () => window.open(btn.href, '_blank') : handlers[btn.prop]}
              style={{
                width: 220, minHeight: 140,
                background: btn.bg,
                border: `2px solid ${btn.border}`,
                borderRadius: 18, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                padding: 24, transition: 'transform .15s, border-color .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <span style={{ fontSize: 36 }}>{btn.label.split(' ')[0]}</span>
              <span style={{ fontWeight: 800, fontSize: 16, color: btn.color, textAlign: 'center' }}>
                {btn.label.slice(btn.label.indexOf(' ') + 1)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
