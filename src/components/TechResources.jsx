import React from 'react';

export default function TechResources({ currentUser, onWorkSchedule, onAdvisorSchedule, onDocumentLibrary, onBack }) {
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
          <button
            onClick={onWorkSchedule}
            style={{
              width: 220, minHeight: 140,
              background: 'linear-gradient(135deg,rgba(167,139,250,.25),rgba(139,92,246,.18))',
              border: '2px solid rgba(167,139,250,.45)',
              borderRadius: 18, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: 24, transition: 'transform .15s, border-color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <span style={{ fontSize: 36 }}>📅</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#c4b5fd' }}>Technician Work Schedule</span>
          </button>

          <button
            onClick={onAdvisorSchedule}
            style={{
              width: 220, minHeight: 140,
              background: 'linear-gradient(135deg,rgba(61,214,195,.25),rgba(110,231,249,.18))',
              border: '2px solid rgba(61,214,195,.45)',
              borderRadius: 18, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: 24, transition: 'transform .15s, border-color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <span style={{ fontSize: 36 }}>🗓</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#6ee7f9' }}>Advisor Work Schedule</span>
          </button>

          <button
            onClick={onDocumentLibrary}
            style={{
              width: 220, minHeight: 140,
              background: 'linear-gradient(135deg,rgba(110,231,249,.25),rgba(61,214,195,.18))',
              border: '2px solid rgba(110,231,249,.45)',
              borderRadius: 18, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: 24, transition: 'transform .15s, border-color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <span style={{ fontSize: 36 }}>📁</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#6ee7f9' }}>Document Library</span>
          </button>
        </div>
      </div>
    </div>
  );
}
