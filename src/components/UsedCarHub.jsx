import React from 'react';

export default function UsedCarHub({ currentUser, currentUserDisplay, onBack }) {
  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🚗 Used Car Hub</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Dashboard</button>
      </div>

      <div style={{ padding: '24px 28px', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          maxWidth: 720, width: '100%',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: '40px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>🚗</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#e2e8f0', marginBottom: 8 }}>Used Car Hub</div>
          <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
            This hub is set up and ready to be built out. Tools and reports for the used-car team will live here.
          </div>
        </div>
      </div>
    </div>
  );
}
