import React from 'react';

/* Live Pay landing page — one box per pay screen.
 *
 * A box only appears for someone who is allowed through it, so a tech never
 * taps into the advisor board and vice versa. Anyone who can only reach one of
 * them is sent straight there by App, so this page never shows a single lonely
 * box.
 */

const CARD = {
  width: 300, minHeight: 190, borderRadius: 22, cursor: 'pointer',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 12, padding: 28, transition: 'transform .15s', position: 'relative', overflow: 'hidden',
};

function PayCard({ icon, title, sub, onClick, a1, a2 }) {
  return (
    <button onClick={onClick}
      style={{ ...CARD, background: `linear-gradient(145deg, ${a1}33, ${a2}1a 55%, rgba(2,6,23,.55))`, border: `1px solid ${a1}77`, boxShadow: `0 18px 44px -24px ${a1}` }}
      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
      <div style={{ position: 'absolute', top: -40, right: -40, width: 150, height: 150, borderRadius: '50%', background: `radial-gradient(circle, ${a1}33, transparent 70%)`, pointerEvents: 'none' }} />
      <span style={{ fontSize: 46, position: 'relative' }}>{icon}</span>
      <span style={{ fontWeight: 900, fontSize: 20, color: a1, textAlign: 'center', position: 'relative' }}>{title}</span>
      <span style={{ fontSize: 12.5, color: '#94a3b8', textAlign: 'center', lineHeight: 1.45, position: 'relative' }}>{sub}</span>
    </button>
  );
}

export default function LivePayHub({ currentUserDisplay, currentUser, showAdvisor, showTech, onAdvisor, onTech, onBack, backLabel = '← Back' }) {
  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <div>
          <div className="adv-title">💵 Live Pay</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={onBack}>{backLabel}</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '40px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        <p style={{ color: '#7a92b8', margin: 0, fontSize: 15 }}>Choose a pay board.</p>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', justifyContent: 'center' }}>
          {showAdvisor && (
            <PayCard icon="🧾" title="Advisor Live Pay" sub="Monthly commission — earned so far and pacing" onClick={onAdvisor} a1="#38bdf8" a2="#0ea5e9" />
          )}
          {showTech && (
            <PayCard icon="🔧" title="Tech Live Pay" sub="Flat rate by the week — banked and pacing" onClick={onTech} a1="#34d399" a2="#10b981" />
          )}
        </div>
      </div>
    </div>
  );
}
