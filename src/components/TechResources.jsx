import React, { useState, useEffect } from 'react';
import { loadGithubFile } from '../utils/github';

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
  {
    key: 'atDiagWorksheet',
    label: '⚙️ AT Diag Worksheet',
    bg: 'linear-gradient(135deg,rgba(251,191,36,.25),rgba(245,158,11,.18))',
    border: 'rgba(251,191,36,.45)',
    color: '#fbbf24',
    prop: 'onATDiagWorksheet',
  },
];

export default function TechResources({ currentUser, currentUserDisplay, currentRole, userPages, onWorkSchedule, onAdvisorSchedule, onDocumentLibrary, onWorkInProgress, onATDiagWorksheet, onMyReview, onMyReports, onBack }) {
  const handlers = { onWorkSchedule, onAdvisorSchedule, onDocumentLibrary, onWorkInProgress, onATDiagWorksheet };
  const visible = NAV_BUTTONS.filter(b => canSee(userPages, currentRole, b.key));

  // Check if this tech has a pending review (only for technician role)
  const [hasPendingReview, setHasPendingReview] = useState(false);
  const [hasSubmittedReview, setHasSubmittedReview] = useState(false);

  useEffect(() => {
    if (!currentUser || currentRole !== 'technician') return;
    const key = currentUser.toLowerCase();
    Promise.all([
      loadGithubFile(`data/tech-reviews/pending/${key}.json`).catch(() => null),
      loadGithubFile(`data/tech-reviews/submissions/${key}/latest.json`).catch(() => null),
    ]).then(([pending, sub]) => {
      setHasPendingReview(!!pending && !sub);
      setHasSubmittedReview(!!sub);
    }).catch(() => {});
  }, [currentUser, currentRole]);

  const showMyReview = currentRole === 'technician' && (hasPendingReview || hasSubmittedReview);

  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <div>
          <div className="adv-title">Technician Resources</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
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

          {/* My Reports */}
          {onMyReports && (
            <button
              onClick={onMyReports}
              style={{ width: 220, minHeight: 140, background: 'linear-gradient(135deg,rgba(110,231,249,.25),rgba(61,214,195,.18))', border: '1px solid rgba(61,214,195,.45)', borderRadius: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, transition: 'transform .15s' }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <span style={{ fontSize: 36 }}>📊</span>
              <span style={{ fontWeight: 800, fontSize: 16, color: '#6ee7f9', textAlign: 'center' }}>My Reports</span>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Performance history</span>
            </button>
          )}

          {/* My Review — only shown when manager has sent a review or tech has submitted */}
          {showMyReview && (
            <button
              onClick={onMyReview}
              style={{
                width: 220, minHeight: 140,
                background: 'linear-gradient(135deg,rgba(236,72,153,.25),rgba(219,39,119,.18))',
                border: `2px solid ${hasPendingReview ? 'rgba(236,72,153,.7)' : 'rgba(236,72,153,.4)'}`,
                borderRadius: 18, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                padding: 24, transition: 'transform .15s',
                position: 'relative',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              {hasPendingReview && (
                <div style={{ position: 'absolute', top: 10, right: 10, background: '#ec4899', color: 'white', borderRadius: 20, fontSize: 10, fontWeight: 900, padding: '2px 8px', letterSpacing: 0.5 }}>
                  ACTION NEEDED
                </div>
              )}
              <span style={{ fontSize: 36 }}>📋</span>
              <span style={{ fontWeight: 800, fontSize: 16, color: '#f9a8d4', textAlign: 'center' }}>
                My Review
              </span>
              <span style={{ fontSize: 11, color: hasSubmittedReview ? '#4ade80' : '#f9a8d4', fontWeight: 700 }}>
                {hasSubmittedReview ? '✅ Submitted' : '⚠️ Needs your response'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
