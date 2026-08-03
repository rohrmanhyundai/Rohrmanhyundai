import React from 'react';

const NAV_BUTTONS = [
  {
    key: 'chargeAccountList',
    label: '💳 Charge Account List',
    desc: 'View approved charge accounts, customer IDs, and tax exempt status',
    bg: 'linear-gradient(135deg,rgba(99,102,241,.28),rgba(79,70,229,.18))',
    border: 'rgba(99,102,241,.45)',
    color: '#a5b4fc',
    prop: 'onChargeAccountList',
  },
  {
    key: 'surveyReports',
    label: '📊 Survey Reports',
    desc: 'View and manage advisor survey review history',
    bg: 'linear-gradient(135deg,rgba(167,139,250,.28),rgba(139,92,246,.18))',
    border: 'rgba(167,139,250,.45)',
    color: '#c4b5fd',
    prop: 'onSurveyReports',
  },
  {
    key: 'advisorCalendar',
    label: '📋 Advisor Calendar',
    desc: 'View appointment prep notes for any advisor',
    bg: 'linear-gradient(135deg,rgba(61,214,195,.28),rgba(16,185,129,.18))',
    border: 'rgba(61,214,195,.45)',
    color: '#6ee7f9',
    prop: 'onAdvisorCalendar',
  },
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
    key: 'employeeReview',
    label: '⭐ Employee Review',
    desc: 'Technician and advisor performance reviews',
    bg: 'linear-gradient(135deg,rgba(236,72,153,.28),rgba(219,39,119,.18))',
    border: 'rgba(236,72,153,.45)',
    color: '#f9a8d4',
    prop: 'onEmployeeReview',
  },
  {
    key: 'performanceReports',
    label: '📊 Performance Reports',
    desc: 'View and manage employee performance history',
    bg: 'linear-gradient(135deg,rgba(20,184,166,.28),rgba(6,182,212,.18))',
    border: 'rgba(20,184,166,.45)',
    color: '#5eead4',
    prop: 'onPerformanceReports',
  },
  {
    key: 'repairOrderDatabase',
    label: '🗂 Repair Order Database',
    desc: 'Search every RO deleted from WIP or Cars Awaiting; restore or purge',
    bg: 'linear-gradient(135deg,rgba(248,113,113,.28),rgba(239,68,68,.18))',
    border: 'rgba(239,68,68,.45)',
    color: '#fca5a5',
    prop: 'onRepairOrderDatabase',
  },
  {
    key: 'goalForecast',
    label: '📈 Goal Forecast',
    desc: 'Forecast monthly gross profit and track daily pace vs. goal',
    bg: 'linear-gradient(135deg,rgba(52,211,153,.28),rgba(16,185,129,.18))',
    border: 'rgba(52,211,153,.45)',
    color: '#6ee7b7',
    prop: 'onGoalForecast',
  },
  {
    key: 'advisorForecast',
    label: '🎯 Advisor Forecast',
    desc: 'Set advisor hours & HRS/RO goals and track daily pace vs. goal',
    bg: 'linear-gradient(135deg,rgba(167,139,250,.30),rgba(236,72,153,.18))',
    border: 'rgba(167,139,250,.5)',
    color: '#d8b4fe',
    prop: 'onAdvisorForecast',
  },
  {
    key: 'userDataTracker',
    label: '📡 User Data Tracker',
    desc: 'Last 30 days of page views and key actions per user',
    bg: 'linear-gradient(135deg,rgba(96,165,250,.28),rgba(59,130,246,.18))',
    border: 'rgba(96,165,250,.45)',
    color: '#bfdbfe',
    prop: 'onUserDataTracker',
  },
  {
    key: 'globalMessage',
    label: '📣 Global Message',
    desc: 'Send a pop-up message to one or more users — appears on their screen instantly',
    bg: 'linear-gradient(135deg,rgba(251,191,36,.28),rgba(245,158,11,.18))',
    border: 'rgba(251,191,36,.5)',
    color: '#fde68a',
    prop: 'onGlobalMessage',
  },
  {
    key: 'cashDash',
    label: '💰 Cash Dash',
    desc: 'August pull pacing per advisor & tech — enter tech hours and see locked pulls',
    bg: 'linear-gradient(135deg,rgba(52,211,153,.28),rgba(245,158,11,.18))',
    border: 'rgba(52,211,153,.5)',
    color: '#6ee7b7',
    prop: 'onCashDash',
  },
];

export default function ManagerHub({
  currentUser, currentUserDisplay, currentRole,
  onBack, onSurveyReports, onAdvisorCalendar, onAftermarketWarranty,
  onDocumentLibrary, onAdvisorSchedule, onTechSchedule, onAdvisorRankBoard,
  onChargeAccountList, onEmployeeReview, onPerformanceReports,
  onRepairOrderDatabase, onUserDataTracker, onGoalForecast, onAdvisorForecast,
  onGlobalMessage, onCashDash,
}) {
  const handlers = {
    onSurveyReports, onAdvisorCalendar, onAftermarketWarranty,
    onDocumentLibrary, onAdvisorSchedule, onTechSchedule, onAdvisorRankBoard,
    onChargeAccountList, onEmployeeReview, onPerformanceReports,
    onRepairOrderDatabase, onUserDataTracker, onGoalForecast, onAdvisorForecast,
    onGlobalMessage, onCashDash,
  };

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">Manager Hub</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Service Operations Dashboard</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '40px 48px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>

          {/* Welcome banner */}
          <div style={{ background: 'linear-gradient(135deg,rgba(167,139,250,.12),rgba(139,92,246,.07))', border: '1px solid rgba(167,139,250,.25)', borderRadius: 16, padding: '24px 32px', marginBottom: 40, display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: 48 }}>🏢</div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 22, color: '#c4b5fd', marginBottom: 4 }}>
                Welcome, {currentUser}
              </div>
              <div style={{ color: '#64748b', fontSize: 14 }}>
                Bob Rohrman Hyundai — Manager Portal
              </div>
            </div>
          </div>

          {/* Navigation cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
            {NAV_BUTTONS.map(btn => (
              <button
                key={btn.key}
                onClick={handlers[btn.prop]}
                style={{
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
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
