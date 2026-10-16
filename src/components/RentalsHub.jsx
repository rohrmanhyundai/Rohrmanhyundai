import React from 'react';
import SortableTiles from './SortableTiles';

// Only tiles with a page-access box, so what a Rentals user sees is exactly
// what's ticked for them in User Management / Role Setup.
const NAV_BUTTONS = [
  {
    key: 'serviceLoaner',
    label: '🚙 Service Loaner',
    desc: 'Loaner requests, signed contracts and loaner maintenance',
    bg: 'linear-gradient(135deg,rgba(96,165,250,.28),rgba(59,130,246,.18))',
    border: 'rgba(96,165,250,.45)',
    color: '#93c5fd',
    prop: 'onServiceLoaner',
  },
  {
    key: 'mobileLoanerMedia',
    label: '📸 Check In / Check Out Media',
    desc: 'Stock #, in or out, then pictures and videos — best on a phone',
    bg: 'linear-gradient(135deg,rgba(192,132,252,.28),rgba(147,51,234,.18))',
    border: 'rgba(192,132,252,.45)',
    color: '#d8b4fe',
    prop: 'onRentalMedia',
  },
  {
    key: 'shopAppointments',
    label: '📅 Shop Appointments',
    desc: 'Every advisor\'s appointments for the day',
    bg: 'linear-gradient(135deg,rgba(56,189,248,.28),rgba(99,102,241,.18))',
    border: 'rgba(56,189,248,.5)',
    color: '#7dd3fc',
    prop: 'onShopAppointments',
  },
  {
    key: 'workSchedule',
    label: '🗓 Work Schedule',
    desc: 'Advisor and technician shifts',
    bg: 'linear-gradient(135deg,rgba(167,139,250,.28),rgba(139,92,246,.18))',
    border: 'rgba(167,139,250,.45)',
    color: '#c4b5fd',
    prop: 'onWorkSchedule',
  },
  {
    key: 'workInProgress',
    label: '🔧 Work in Progress',
    desc: 'Vehicles in the shop and where they stand',
    bg: 'linear-gradient(135deg,rgba(251,146,60,.28),rgba(234,88,12,.18))',
    border: 'rgba(251,146,60,.45)',
    color: '#fdba74',
    prop: 'onWorkInProgress',
  },
  {
    key: 'whitePaint',
    label: '🎨 White Paint',
    desc: 'Paint repair waiting list — who\'s next up',
    bg: 'linear-gradient(135deg,rgba(226,232,240,.28),rgba(148,163,184,.18))',
    border: 'rgba(226,232,240,.45)',
    color: '#f1f5f9',
    prop: 'onWhitePaint',
  },
  {
    key: 'aftermarketWarranty',
    label: '🛡 After Market Warranty/Tire Warranty',
    desc: 'View and manage warranty claims',
    bg: 'linear-gradient(135deg,rgba(52,211,153,.28),rgba(16,185,129,.18))',
    border: 'rgba(52,211,153,.45)',
    color: '#6ee7b7',
    prop: 'onAftermarketWarranty',
  },
  {
    key: 'documentLibrary',
    label: '📁 Document Library',
    desc: 'Forms and reference documents',
    bg: 'linear-gradient(135deg,rgba(110,231,249,.28),rgba(61,214,195,.18))',
    border: 'rgba(110,231,249,.45)',
    color: '#6ee7f9',
    prop: 'onDocumentLibrary',
  },
  {
    key: 'tireQuote',
    label: '🛞 Tire Quote',
    desc: 'Get a tire quote from Hyundai Tire Center',
    bg: 'linear-gradient(135deg,rgba(74,222,128,.28),rgba(34,197,94,.18))',
    border: 'rgba(74,222,128,.45)',
    color: '#4ade80',
    prop: 'onTireQuote',
  },
];

export default function RentalsHub({
  currentUser, currentUserDisplay,
  onBack, onServiceLoaner, onRentalMedia, onShopAppointments, onWorkSchedule, onWorkInProgress, onWhitePaint, onAftermarketWarranty, onDocumentLibrary, onTireQuote,
}) {
  const handlers = { onServiceLoaner, onRentalMedia, onShopAppointments, onWorkSchedule, onWorkInProgress, onWhitePaint, onAftermarketWarranty, onDocumentLibrary, onTireQuote };
  // A tile needs a handler from App — App leaves one out when its box is off.
  const visible = NAV_BUTTONS.filter(b => handlers[b.prop]);

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">Rentals Hub</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Service Operations Dashboard</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '40px 48px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>

          {/* Welcome banner */}
          <div style={{ background: 'linear-gradient(135deg,rgba(96,165,250,.12),rgba(59,130,246,.07))', border: '1px solid rgba(96,165,250,.2)', borderRadius: 16, padding: '24px 32px', marginBottom: 40, display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: 48 }}>🚙</div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 22, color: '#93c5fd', marginBottom: 4 }}>
                Welcome, {currentUser}
              </div>
              <div style={{ color: '#64748b', fontSize: 14 }}>
                Bob Rohrman Hyundai — Rentals &amp; Loaners
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
            <SortableTiles
              hubKey="rentalsHub"
              currentUser={currentUser}
              items={visible}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}
            >
              {btn => (
                <button
                  onClick={btn.href ? () => window.open(btn.href, '_blank') : handlers[btn.prop]}
                  style={{
                    width: '100%', height: '100%',
                    background: btn.bg,
                    border: `1px solid ${btn.border}`,
                    borderRadius: 16,
                    padding: '28px 24px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'transform .15s, box-shadow .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                >
                  <div style={{ fontSize: 28, marginBottom: 12 }}>{btn.label.split(' ')[0]}</div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: btn.color, marginBottom: 6 }}>
                    {btn.label.slice(btn.label.indexOf(' ') + 1)}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{btn.desc}</div>
                </button>
              )}
            </SortableTiles>
          )}
        </div>
      </div>
    </div>
  );
}
