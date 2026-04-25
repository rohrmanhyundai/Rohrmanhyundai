import React, { useState } from 'react';
import { n, pct, safe } from '../utils/formatters';
import { advisorProjectedHours } from '../utils/calculations';

function StatRow({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ color: '#7a92b8', fontSize: 13 }}>{label}</span>
      <span style={{ color: highlight ? '#4fc3f7' : '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{value}</span>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ color: '#4fc3f7', fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function GaugeBar({ label, actual, goal, prefix = '$' }) {
  const pctVal = goal > 0 ? Math.min((actual / goal) * 100, 100) : 0;
  const color = pctVal >= 100 ? '#4ade80' : pctVal >= 75 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ color: '#7a92b8', fontSize: 13 }}>{label}</span>
        <span style={{ color, fontWeight: 700, fontSize: 13 }}>{pctVal.toFixed(1)}%</span>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pctVal}%`, height: '100%', background: color, borderRadius: 6, transition: 'width .4s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>Actual: {prefix}{n(actual)}</span>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>Goal: {prefix}{n(goal)}</span>
      </div>
    </div>
  );
}

export default function MobileDashboard({ data, vacations, isLoggedIn, currentUser, currentRole, canEditDashboard, onLogin, onLogout, onEdit, onAdvisor, onTechnician, onAdvisorSchedule, onTechSchedule }) {
  const [showLogin, setShowLogin] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');

  const advisors = (data.advisors || []).filter(a => !a.hidden);
  const hiddenNames = new Set((data.advisors || []).filter(a => a.hidden).map(a => a.name.toUpperCase()));
  const techs = data.technicians || [];
  const vacs = (vacations || []);
  const advisorTraining = (data.advisorTraining || []).filter(a => !hiddenNames.has(a.name.toUpperCase()));

  const techWeekTotal = data.techTotals?.week_total ?? 0;
  const techWeekGoal = techs.reduce((s, t) => s + (t.goal || 0), 0);
  const techPct = techWeekGoal > 0 ? ((techWeekTotal / techWeekGoal) * 100).toFixed(1) : '0.0';

  return (
    <div style={{ minHeight: '100vh', background: '#0d1627', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '16px 14px 32px' }}>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: '#4fc3f7', fontWeight: 800, fontSize: 18, letterSpacing: 0.5 }}>{data.title || 'Service Dashboard'}</div>
        <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 2 }}>{data.advisorSummary?.date || ''}</div>
      </div>

      {/* Auth bar */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isLoggedIn ? (
          <>
            <button onClick={onAdvisorSchedule} style={btnStyle('#1a2e3a', '#38bdf8')}>📅 Advisor Schedule</button>
            <button onClick={onTechSchedule} style={btnStyle('#1f2a3a', '#818cf8')}>🔧 Tech Schedule</button>
            <button onClick={onLogout} style={btnStyle('#2a1f1f', '#f87171')}>Logout</button>
          </>
        ) : (
          <button onClick={() => setShowLogin(v => !v)} style={btnStyle('#1e3a5f', '#4fc3f7')}>Login</button>
        )}
      </div>

      {showLogin && !isLoggedIn && (
        <Card title="Login">
          <input placeholder="Username" value={loginUser} onChange={e => setLoginUser(e.target.value)}
            style={inputStyle} />
          <input placeholder="Password" type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)}
            style={{ ...inputStyle, marginTop: 8 }} />
          <button onClick={() => { onLogin(loginUser, loginPass); setShowLogin(false); }} style={{ ...btnStyle('#1e3a5f', '#4fc3f7'), marginTop: 10, width: '100%' }}>
            Sign In
          </button>
        </Card>
      )}

      {/* Goals */}
      <Card title="Monthly Goals">
        <GaugeBar label="Gross Profit" actual={data.grossActual || 0} goal={data.grossGoal || 1} />
        <GaugeBar label="Customer Pay" actual={data.cpActual || 0} goal={data.cpGoal || 1} />
      </Card>

      {/* Tech Production */}
      <Card title="Tech Production — This Week">
        <StatRow label="Week Total Hrs" value={`${techWeekTotal} hrs`} highlight />
        <StatRow label="Goal %" value={`${techPct}%`} highlight />
        {techs.map(t => (
          <StatRow key={t.name} label={t.name} value={`${t.total ?? 0} / ${t.goal ?? 0} hrs`} />
        ))}
      </Card>

      {/* Advisor Performance */}
      <Card title="Advisor Performance">
        {advisors.length === 0 && <div style={{ color: '#7a92b8', fontSize: 13 }}>No advisor data.</div>}
        {advisors.map(a => (
          <div key={a.name} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{a.name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 0' }}>
              {[
                ['MTD Hours', n(a.mtd_hours, 1)],
                ['Pacing', `${advisorProjectedHours(a, data).toFixed(1)} hrs`],
                ['Hrs/RO', n(a.hours_per_ro, 2)],
                ['Roh$50 HRS/RO', n(a.roh50_hrs_ro, 2)],
                ['Alignment %', pct(a.align, 1)],
                ['Tires %', pct(a.tires, 1)],
                ['Valvoline %', pct(a.valvoline, 1)],
                ['CSI', Math.round(safe(a.csi, 0)).toString()],
                ['ASR %', pct(a.asr, 1)],
                ['ELR %', pct(a.elr, 0)],
              ].map(([lbl, val]) => (
                <React.Fragment key={lbl}>
                  <span style={{ color: '#7a92b8', fontSize: 12 }}>{lbl}</span>
                  <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{val}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </Card>

      {/* Training */}
      <Card title="Training Center">
        {techs.length === 0 && advisorTraining.length === 0
          ? <div style={{ color: '#7a92b8', fontSize: 13 }}>No training data.</div>
          : [...techs, ...advisorTraining].map((p, i) => (
            <div key={i} style={{ padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{p.name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                {[
                  ['Certified', p.certified],
                  ['Training Due', p.trainings_due],
                  ['Excel', p.excel_training ?? p.excel],
                ].map(([lbl, val]) => (
                  <div key={lbl} style={{ textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '4px 2px' }}>
                    <div style={{ color: '#7a92b8', fontSize: 10, marginBottom: 2 }}>{lbl}</div>
                    <div style={{
                      color: val === 'YES' ? '#4ade80' : val === 'NO' ? '#f87171' : '#e2e8f0',
                      fontWeight: 700, fontSize: 12,
                    }}>{val || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        }
      </Card>

      {/* Vacations */}
      <Card title="Approved Vacation">
        {vacs.length === 0
          ? <div style={{ color: '#7a92b8', fontSize: 13 }}>No vacations scheduled.</div>
          : vacs.map((v, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 13 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{v.name}</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#7a92b8' }}>{v.dates}</div>
                <div style={{ color: '#4ade80', fontSize: 11, fontWeight: 600 }}>{v.status}</div>
              </div>
            </div>
          ))
        }
      </Card>
    </div>
  );
}

const btnStyle = (bg, color) => ({
  background: bg, color, border: `1px solid ${color}40`, borderRadius: 8,
  padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
});

const inputStyle = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0',
  padding: '9px 12px', fontSize: 14,
};
