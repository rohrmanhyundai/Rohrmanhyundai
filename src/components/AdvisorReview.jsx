import React from 'react';

export default function AdvisorReview({ onBack, currentUser }) {
  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">💼 Advisor Reviews</div>
          <div className="adv-sub">Performance Reviews — Service Advisors</div>
        </div>
        <button className="secondary" onClick={onBack}>← Employee Review</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '40px 32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#475569' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>💼</div>
          <div style={{ fontWeight: 900, fontSize: 20, color: '#94a3b8', marginBottom: 8 }}>Advisor Reviews</div>
          <div style={{ fontSize: 14, color: '#475569' }}>Coming soon — review content will appear here.</div>
        </div>
      </div>
    </div>
  );
}
