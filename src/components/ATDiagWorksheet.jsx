import React from 'react';

export default function ATDiagWorksheet({ onBack, onDCTMTM, backLabel = '← Technician Resources' }) {
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
          <button
            onClick={onDCTMTM}
            style={{
              width: 260, minHeight: 160,
              background: 'linear-gradient(135deg,rgba(251,191,36,.25),rgba(245,158,11,.18))',
              border: '2px solid rgba(251,191,36,.45)',
              borderRadius: 18, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
              padding: 28, transition: 'transform .15s, border-color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <span style={{ fontSize: 42 }}>⚙️</span>
            <span style={{ fontWeight: 800, fontSize: 15, color: '#fbbf24', textAlign: 'center' }}>
              DCT & MTM Diagnosis Worksheet
            </span>
            <span style={{ fontSize: 11, color: '#92400e', textAlign: 'center' }}>
              Remanufactured DCT & MTM Core Return
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
