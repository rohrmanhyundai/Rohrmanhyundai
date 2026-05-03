import React, { useState, useEffect } from 'react';
import { loadGithubFile } from '../utils/github';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function pct(val) {
  if (val === null || val === undefined || val === '') return '—';
  return (parseFloat(val) * 100).toFixed(1) + '%';
}

function num(val, decimals = 1) {
  if (val === null || val === undefined || val === '') return '—';
  return parseFloat(val).toFixed(decimals);
}

function StatBox({ label, value, sub, color = '#6ee7f9' }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 18px', minWidth: 110, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TrendArrow({ entries, field, higher = true }) {
  if (entries.length < 2) return null;
  const prev = parseFloat(entries[entries.length - 2]?.[field]);
  const curr = parseFloat(entries[entries.length - 1]?.[field]);
  if (isNaN(prev) || isNaN(curr)) return null;
  const up = curr > prev;
  const same = curr === prev;
  if (same) return <span style={{ color: '#64748b', fontSize: 12 }}>→</span>;
  const good = higher ? up : !up;
  return <span style={{ color: good ? '#4ade80' : '#f87171', fontSize: 13 }}>{up ? '▲' : '▼'}</span>;
}

export default function PerformanceReport({ currentUser, role, onBack }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all'); // 'all' | 'monthly' | 'weekly'

  const username = (currentUser || '').toUpperCase();
  const isAdvisor = (role || '').toLowerCase() === 'advisor';
  const isTech    = (role || '').toLowerCase() === 'technician';

  useEffect(() => {
    setLoading(true);
    loadGithubFile(`data/performance-reports/${username}.json`)
      .then(d => setEntries(Array.isArray(d) ? d.sort((a, b) => new Date(a.date) - new Date(b.date)) : []))
      .finally(() => setLoading(false));
  }, [username]);

  // Filter by tab
  const now = new Date();
  const filtered = entries.filter(e => {
    if (tab === 'all') return true;
    const d = new Date(e.date);
    if (tab === 'weekly') {
      const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
      return d >= weekAgo;
    }
    if (tab === 'monthly') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    if (tab === 'yearly') {
      return d.getFullYear() === now.getFullYear();
    }
    return true;
  });

  const latest = filtered[filtered.length - 1] || null;

  const tabBtn = (key, label) => (
    <button onClick={() => setTab(key)} style={{
      background: tab === key ? 'rgba(61,214,195,.2)' : 'rgba(255,255,255,.05)',
      border: `1px solid ${tab === key ? 'rgba(61,214,195,.4)' : 'rgba(255,255,255,.1)'}`,
      color: tab === key ? '#6ee7f9' : '#64748b',
      borderRadius: 8, padding: '6px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
    }}>{label}</button>
  );

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">📊 My Performance Reports</div>
          <div className="adv-sub">{username} · Personal history</div>
        </div>
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>

          {/* Time filter tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            {tabBtn('weekly', 'This Week')}
            {tabBtn('monthly', 'This Month')}
            {tabBtn('yearly', 'This Year')}
            {tabBtn('all', 'All Time')}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#64748b' }}>⏳ Loading your reports…</div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
              <div style={{ fontWeight: 900, fontSize: 18, color: '#94a3b8', marginBottom: 8 }}>No Reports Yet</div>
              <div style={{ fontSize: 14, color: '#475569' }}>Your manager will send your first report snapshot soon. Check back after your next weekly review.</div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>No entries for this time period.</div>
          ) : (
            <>
              {/* Latest snapshot highlight */}
              {latest && (
                <div style={{ background: 'linear-gradient(135deg,rgba(61,214,195,.1),rgba(110,231,249,.06))', border: '1px solid rgba(61,214,195,.25)', borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                    📌 Latest Snapshot — {fmtDate(latest.date)}
                    {latest.label && <span style={{ marginLeft: 8, color: '#64748b' }}>· {latest.label}</span>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {isAdvisor && <>
                      <StatBox label="CSI" value={latest.csi || '—'} color="#4ade80" />
                      <StatBox label="Hours/RO" value={num(latest.hours_per_ro)} color="#6ee7f9" />
                      <StatBox label="MTD Hours" value={num(latest.mtd_hours, 1)} color="#6ee7f9" />
                      <StatBox label="Daily Avg" value={num(latest.daily_avg)} color="#c4b5fd" />
                      <StatBox label="Alignment" value={pct(latest.align)} color="#fbbf24" />
                      <StatBox label="Tires" value={pct(latest.tires)} color="#fbbf24" />
                      <StatBox label="Valvoline" value={pct(latest.valvoline)} color="#fbbf24" />
                      <StatBox label="ASR" value={pct(latest.asr)} color="#fdba74" />
                      <StatBox label="ELR" value={num(latest.elr, 2)} color="#fdba74" />
                      <StatBox label="Last Month" value={num(latest.last_month_total, 1)} sub="total hrs" color="#94a3b8" />
                    </>}
                    {isTech && <>
                      <StatBox label="Week Total" value={num(latest.total, 1)} sub="hrs" color="#4ade80" />
                      <StatBox label="Goal" value={num(latest.goal, 1)} sub="hrs" color="#6ee7f9" />
                      <StatBox label="Goal %" value={pct(latest.goal_pct)} color={parseFloat(latest.goal_pct) >= 1 ? '#4ade80' : '#f87171'} />
                      <StatBox label="Pacing" value={num(latest.pacing, 1)} sub="projected" color="#c4b5fd" />
                      <StatBox label="Mon" value={num(latest.mon, 1)} color="#94a3b8" />
                      <StatBox label="Tue" value={num(latest.tue, 1)} color="#94a3b8" />
                      <StatBox label="Wed" value={num(latest.wed, 1)} color="#94a3b8" />
                      <StatBox label="Thu" value={num(latest.thu, 1)} color="#94a3b8" />
                      <StatBox label="Fri" value={num(latest.fri, 1)} color="#94a3b8" />
                      <StatBox label="Sat" value={num(latest.sat, 1)} color="#94a3b8" />
                    </>}
                  </div>
                </div>
              )}

              {/* History table */}
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                History ({filtered.length} snapshot{filtered.length !== 1 ? 's' : ''})
              </div>
              <div style={{ overflowX: 'auto' }}>
                {isAdvisor && (
                  <table className="adv-table" style={{ minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th>DATE</th><th>LABEL</th><th>CSI</th><th>HRS/RO</th><th>MTD HRS</th><th>DAILY AVG</th><th>ALIGN</th><th>TIRES</th><th>VALVOLINE</th><th>ASR</th><th>ELR</th><th>LAST MO.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...filtered].reverse().map((e, i) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap', color: '#94a3b8' }}>{fmtDate(e.date)}</td>
                          <td style={{ color: '#64748b', fontSize: 12 }}>{e.label || '—'}</td>
                          <td style={{ color: '#4ade80', fontWeight: 700 }}>{e.csi || '—'} <TrendArrow entries={filtered} field="csi" /></td>
                          <td>{num(e.hours_per_ro)} <TrendArrow entries={filtered} field="hours_per_ro" /></td>
                          <td>{num(e.mtd_hours, 1)} <TrendArrow entries={filtered} field="mtd_hours" /></td>
                          <td>{num(e.daily_avg)} <TrendArrow entries={filtered} field="daily_avg" /></td>
                          <td>{pct(e.align)} <TrendArrow entries={filtered} field="align" /></td>
                          <td>{pct(e.tires)} <TrendArrow entries={filtered} field="tires" /></td>
                          <td>{pct(e.valvoline)} <TrendArrow entries={filtered} field="valvoline" /></td>
                          <td>{pct(e.asr)} <TrendArrow entries={filtered} field="asr" /></td>
                          <td>{num(e.elr, 2)} <TrendArrow entries={filtered} field="elr" /></td>
                          <td>{num(e.last_month_total, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {isTech && (
                  <table className="adv-table" style={{ minWidth: 800 }}>
                    <thead>
                      <tr>
                        <th>DATE</th><th>LABEL</th><th>TOTAL HRS</th><th>GOAL</th><th>GOAL %</th><th>PACING</th><th>MON</th><th>TUE</th><th>WED</th><th>THU</th><th>FRI</th><th>SAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...filtered].reverse().map((e, i) => {
                        const gp = parseFloat(e.goal_pct);
                        return (
                          <tr key={i}>
                            <td style={{ whiteSpace: 'nowrap', color: '#94a3b8' }}>{fmtDate(e.date)}</td>
                            <td style={{ color: '#64748b', fontSize: 12 }}>{e.label || '—'}</td>
                            <td style={{ fontWeight: 700, color: '#4ade80' }}>{num(e.total, 1)} <TrendArrow entries={filtered} field="total" /></td>
                            <td style={{ color: '#6ee7f9' }}>{num(e.goal, 1)}</td>
                            <td style={{ fontWeight: 700, color: gp >= 1 ? '#4ade80' : gp >= 0.8 ? '#fbbf24' : '#f87171' }}>{pct(e.goal_pct)}</td>
                            <td style={{ color: '#c4b5fd' }}>{num(e.pacing, 1)}</td>
                            <td style={{ color: '#94a3b8' }}>{num(e.mon, 1)}</td>
                            <td style={{ color: '#94a3b8' }}>{num(e.tue, 1)}</td>
                            <td style={{ color: '#94a3b8' }}>{num(e.wed, 1)}</td>
                            <td style={{ color: '#94a3b8' }}>{num(e.thu, 1)}</td>
                            <td style={{ color: '#94a3b8' }}>{num(e.fri, 1)}</td>
                            <td style={{ color: '#94a3b8' }}>{num(e.sat, 1)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
