import React from 'react';

function canSee(pages, role, key) {
  if (role === 'admin' || (role || '').includes('manager')) return true;
  if (!pages) return true;
  return pages[key] !== false;
}

// prop: name of callback passed in from App.jsx (for internal navigation)
// href: opens external URL directly (no prop needed)
const NAV_BUTTONS = [
  {
    key: 'aftermarketWarranty',
    label: '🛡 After Market Warranty',
    desc: 'View and manage warranty claims',
    bg: 'linear-gradient(135deg,rgba(52,211,153,.28),rgba(16,185,129,.18))',
    border: 'rgba(52,211,153,.45)',
    color: '#6ee7b7',
    prop: 'onAftermarketWarranty',
  },
  {
    key: 'documentLibrary',
    label: '📁 Document Library',
    desc: 'Access forms and reference documents',
    bg: 'linear-gradient(135deg,rgba(110,231,249,.28),rgba(61,214,195,.18))',
    border: 'rgba(110,231,249,.45)',
    color: '#6ee7f9',
    prop: 'onDocumentLibrary',
  },
  {
    key: 'advisorCalendar',
    label: '📅 Advisor Calendar',
    desc: 'View the advisor daily calendar',
    bg: 'linear-gradient(135deg,rgba(167,139,250,.28),rgba(139,92,246,.18))',
    border: 'rgba(167,139,250,.45)',
    color: '#c4b5fd',
    prop: 'onAdvisorCalendar',
  },
  {
    key: 'advisorSchedule',
    label: '📅 Advisor Schedule',
    desc: 'View the service advisor work schedule',
    bg: 'linear-gradient(135deg,rgba(167,139,250,.28),rgba(139,92,246,.18))',
    border: 'rgba(167,139,250,.45)',
    color: '#c4b5fd',
    prop: 'onAdvisorSchedule',
  },
  {
    key: 'techSchedule',
    label: '🔧 Tech Schedule',
    desc: 'View the technician work schedule',
    bg: 'linear-gradient(135deg,rgba(251,146,60,.28),rgba(249,115,22,.18))',
    border: 'rgba(251,146,60,.45)',
    color: '#fdba74',
    prop: 'onTechSchedule',
  },
  {
    key: 'advisorRankBoard',
    label: '🏆 Advisor Rank Board',
    desc: 'View advisor performance rankings',
    bg: 'linear-gradient(135deg,rgba(251,191,36,.28),rgba(245,158,11,.18))',
    border: 'rgba(251,191,36,.45)',
    color: '#fde68a',
    prop: 'onAdvisorRankBoard',
  },
  {
    key: 'workInProgress',
    label: '🔧 Work in Progress',
    desc: 'View and manage technician work in progress',
    bg: 'linear-gradient(135deg,rgba(251,146,60,.28),rgba(234,88,12,.18))',
    border: 'rgba(251,146,60,.45)',
    color: '#fb923c',
    prop: 'onWorkInProgress',
  },
  {
    key: 'tireQuote',
    label: '🛞 Tire Quote',
    desc: 'Get a tire quote from Hyundai Tire Center',
    bg: 'linear-gradient(135deg,rgba(74,222,128,.28),rgba(34,197,94,.18))',
    border: 'rgba(74,222,128,.45)',
    color: '#4ade80',
    href: 'https://hyundaitirecenter.com/InitDealer?dealer=IN007',
  },
];

export default function PartsHub({
  currentUser, currentUserDisplay, currentRole, userPages,
  onBack, onAftermarketWarranty, onDocumentLibrary,
  onAdvisorCalendar, onAdvisorSchedule, onTechSchedule, onAdvisorRankBoard, onWorkInProgress,
}) {
  const handlers = { onAftermarketWarranty, onDocumentLibrary, onAdvisorCalendar, onAdvisorSchedule, onTechSchedule, onAdvisorRankBoard, onWorkInProgress };
  const visible = NAV_BUTTONS.filter(b => canSee(userPages, currentRole, b.key));

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">Parts Hub</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Service Operations Dashboard</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '40px 48px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>

          {/* Welcome banner */}
          <div style={{ background: 'linear-gradient(135deg,rgba(61,214,195,.12),rgba(110,231,249,.07))', border: '1px solid rgba(61,214,195,.2)', borderRadius: 16, padding: '24px 32px', marginBottom: 40, display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: 48 }}>⚙️</div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 22, color: '#6ee7f9', marginBottom: 4 }}>
                Welcome, {currentUser}
              </div>
              <div style={{ color: '#64748b', fontSize: 14 }}>
                Bob Rohrman Hyundai — Parts Department
              </div>
            </div>
          </div>

          {/* Navigation cards */}
          {visible.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569', padding: '60px 0', fontSize: 15 }}>
              No pages have been enabled for your account.<br />
              <span style={{ fontSize: 13, color: '#334155' }}>Contact an admin to grant access.</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
              {visible.map(btn => (
                <button
                  key={btn.key}
                  onClick={btn.href ? () => window.open(btn.href, '_blank') : handlers[btn.prop]}
                  style={{
                    background: btn.bg,
                    border: `1px solid ${btn.border}`,
                    borderRadius: 16,
                    padding: '28px 24px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'transform .15s, box-shadow .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,0.3)`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                >
                  <div style={{ fontSize: 28, marginBottom: 12 }}>{btn.label.split(' ')[0]}</div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: btn.color, marginBottom: 6 }}>
                    {btn.label.slice(btn.label.indexOf(' ') + 1)}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{btn.desc}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
