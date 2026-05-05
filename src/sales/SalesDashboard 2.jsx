import React, { useState, useEffect, useCallback } from 'react';
import { loadGithubFile } from '../utils/github';

const REFRESH_MS = 5 * 60 * 1000; // auto-refresh every 5 min

function pct(val, goal) {
  if (!goal) return 0;
  return Math.min(100, Math.round((val / goal) * 100));
}

function fmtMoney(n) {
  if (!n && n !== 0) return '$0';
  return '$' + Number(n).toLocaleString();
}

function GoalBar({ value, goal, color }) {
  const p = pct(value, goal);
  const barColor = p >= 100 ? '#4ade80' : p >= 66 ? '#4ade80' : p >= 40 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginBottom: 3 }}>
        <span>{value} / {goal}</span><span>{p}%</span>
      </div>
      <div style={{ height: 7, background: 'rgba(255,255,255,.08)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${p}%`, background: barColor, borderRadius: 4, transition: 'width .6s ease' }} />
      </div>
    </div>
  );
}

function KPICard({ icon, label, value, sub, color = '#60a5fa', big = false }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${color}33`, borderRadius: 16, padding: big ? '20px 22px' : '16px 18px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: big ? 28 : 22, fontWeight: 900, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function statusColor(p) {
  if (p >= 80) return '#4ade80';
  if (p >= 50) return '#fbbf24';
  return '#f87171';
}

export default function SalesDashboard({ currentUser, isAdmin }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await loadGithubFile('data/sales/dashboard.json');
      setData(d);
    } catch {}
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh', color: '#475569', fontSize: 16 }}>
      ⏳ Loading Sales Board…
    </div>
  );

  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 52 }}>📋</div>
      <div style={{ fontWeight: 900, fontSize: 20, color: '#475569' }}>No Sales Data Yet</div>
      {isAdmin && <div style={{ fontSize: 14, color: '#334155' }}>Go to Admin to set up the sales board.</div>}
    </div>
  );

  const salespeople = data.salespeople || [];
  const goals = data.goals || {};
  const team = data.team || {};
  const extras = data.extras || {};

  // Sorted leaderboard
  const sorted = [...salespeople].sort((a, b) => (b.units_new + b.units_used) - (a.units_new + a.units_used));
  const topPerformer = sorted[0] || null;

  // Team totals
  const totalUnits = salespeople.reduce((s, p) => s + (p.units_new || 0) + (p.units_used || 0), 0);
  const totalGross  = salespeople.reduce((s, p) => s + (p.gross || 0), 0);
  const totalFI     = salespeople.reduce((s, p) => s + (p.fi_products || 0), 0);
  const avgCSI      = salespeople.length ? Math.round(salespeople.reduce((s, p) => s + (p.csi || 0), 0) / salespeople.length) : 0;
  const fiPct       = goals.fi_goal ? Math.round((totalFI / goals.fi_goal) * 100) : 0;

  const now = new Date();
  const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 26, color: '#e2e8f0', lineHeight: 1.1 }}>
            {data.title || `${monthName} Sales Performance`}
          </div>
          <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
            Bob Rohrman Hyundai · Updated {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
            <button onClick={load} style={{ marginLeft: 10, background: 'none', border: 'none', color: '#3b82f6', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>↻ Refresh</button>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>{now.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          {team.units_today != null && (
            <div style={{ fontWeight: 900, color: '#4ade80', fontSize: 18, marginTop: 2 }}>🚗 {team.units_today} sold today</div>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 22 }}>
        <KPICard icon="📅" label="MTD Units" value={`${totalUnits} / ${goals.units_goal || '—'}`} sub={goals.units_goal ? `${pct(totalUnits, goals.units_goal)}% of goal` : ''} color="#60a5fa" />
        <KPICard icon="💰" label="Gross Profit MTD" value={fmtMoney(totalGross)} sub={goals.gross_goal ? `Goal: ${fmtMoney(goals.gross_goal)}` : ''} color="#4ade80" />
        <KPICard icon="🛡️" label="F&I Products" value={totalFI} sub={goals.fi_goal ? `${fiPct}% of goal (${goals.fi_goal})` : ''} color="#a78bfa" />
        <KPICard icon="⭐" label="Avg CSI Score" value={avgCSI ? `${avgCSI}%` : '—'} sub="Customer Satisfaction" color="#fbbf24" />
        {team.appointments != null && <KPICard icon="📞" label="Appts Today" value={team.appointments} color="#2dd4bf" />}
        {team.pending_deliveries != null && <KPICard icon="🚚" label="Pending Deliveries" value={team.pending_deliveries} color="#fb923c" />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 18 }}>

        {/* Main leaderboard */}
        <div>
          {/* Top Performer Banner */}
          {topPerformer && (
            <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.18),rgba(245,158,11,.1))', border: '1px solid rgba(251,191,36,.4)', borderRadius: 14, padding: '16px 22px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ fontSize: 42 }}>🥇</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#b45309', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Top Performer</div>
                <div style={{ fontWeight: 900, fontSize: 22, color: '#fbbf24' }}>{topPerformer.name}</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
                  {(topPerformer.units_new || 0) + (topPerformer.units_used || 0)} units · {fmtMoney(topPerformer.gross)} gross · {topPerformer.csi || '—'}% CSI
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 900, fontSize: 32, color: '#fbbf24' }}>{(topPerformer.units_new || 0) + (topPerformer.units_used || 0)}</div>
                <div style={{ fontSize: 11, color: '#92400e' }}>UNITS SOLD</div>
              </div>
            </div>
          )}

          {/* Leaderboard Table */}
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, overflow: 'hidden' }}>
            {/* Table Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px 90px 110px 70px 70px 110px', gap: 0, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)' }}>
              {['#', 'Salesperson', 'New', 'Used', 'Gross', 'F&I', 'CSI', 'Goal'].map((h, i) => (
                <div key={h} style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.8, textAlign: i > 1 ? 'center' : 'left' }}>{h}</div>
              ))}
            </div>

            {sorted.length === 0 && (
              <div style={{ padding: '32px', textAlign: 'center', color: '#334155', fontSize: 14 }}>No salespeople added yet.</div>
            )}

            {sorted.map((sp, idx) => {
              const total = (sp.units_new || 0) + (sp.units_used || 0);
              const p = pct(total, sp.goal || goals.individual_goal || 0);
              const barColor = statusColor(p);
              const rowBg = idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.015)';
              return (
                <div key={sp.id || sp.name} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px 90px 110px 70px 70px 110px', gap: 0, padding: '12px 16px', background: rowBg, borderBottom: '1px solid rgba(255,255,255,.04)', alignItems: 'center' }}>
                  <div style={{ fontWeight: 900, fontSize: 14, color: idx === 0 ? '#fbbf24' : '#334155' }}>
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: '#e2e8f0' }}>{sp.name}</div>
                    {sp.title && <div style={{ fontSize: 11, color: '#475569' }}>{sp.title}</div>}
                  </div>
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, color: '#60a5fa' }}>{sp.units_new || 0}</div>
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, color: '#a78bfa' }}>{sp.units_used || 0}</div>
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: '#4ade80' }}>{fmtMoney(sp.gross)}</div>
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, color: '#f9a8d4' }}>{sp.fi_products || 0}</div>
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: (sp.csi || 0) >= 95 ? '#4ade80' : (sp.csi || 0) >= 90 ? '#fbbf24' : '#f87171' }}>
                    {sp.csi ? `${sp.csi}%` : '—'}
                  </div>
                  <div style={{ paddingRight: 4 }}>
                    <GoalBar value={total} goal={sp.goal || goals.individual_goal || 0} />
                  </div>
                </div>
              );
            })}

            {/* Team totals row */}
            {salespeople.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px 90px 110px 70px 70px 110px', gap: 0, padding: '12px 16px', background: 'rgba(59,130,246,.06)', borderTop: '2px solid rgba(59,130,246,.2)', alignItems: 'center' }}>
                <div />
                <div style={{ fontWeight: 900, fontSize: 13, color: '#60a5fa' }}>TEAM TOTAL</div>
                <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 15, color: '#60a5fa' }}>{salespeople.reduce((s, p) => s + (p.units_new || 0), 0)}</div>
                <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 15, color: '#a78bfa' }}>{salespeople.reduce((s, p) => s + (p.units_used || 0), 0)}</div>
                <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 13, color: '#4ade80' }}>{fmtMoney(totalGross)}</div>
                <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 14, color: '#f9a8d4' }}>{totalFI}</div>
                <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 13, color: '#fbbf24' }}>{avgCSI ? `${avgCSI}%` : '—'}</div>
                <div>
                  <GoalBar value={totalUnits} goal={goals.units_goal || 0} />
                </div>
              </div>
            )}
          </div>

          {/* Trade-ins if available */}
          {team.trade_ins != null && (
            <div style={{ marginTop: 14, display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24 }}>🔄</span>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 20, color: '#e2e8f0' }}>{team.trade_ins}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Trade-Ins Appraised</div>
                </div>
              </div>
              {team.test_drives != null && (
                <div style={{ flex: 1, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>🚗</span>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 20, color: '#e2e8f0' }}>{team.test_drives}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Test Drives Today</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Team Goal Gauge */}
          {goals.units_goal > 0 && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ fontWeight: 900, fontSize: 13, color: '#e2e8f0', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                🎯 Team Goal
              </div>
              <div style={{ textAlign: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 40, color: pct(totalUnits, goals.units_goal) >= 100 ? '#4ade80' : '#60a5fa', lineHeight: 1 }}>{totalUnits}</div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>of {goals.units_goal} units</div>
              </div>
              <GoalBar value={totalUnits} goal={goals.units_goal} />
              <div style={{ marginTop: 10, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
                {goals.units_goal - totalUnits > 0 ? `${goals.units_goal - totalUnits} units to go` : '🎉 Goal Reached!'}
              </div>
            </div>
          )}

          {/* Incentives */}
          {extras.incentives?.length > 0 && (
            <div style={{ background: 'linear-gradient(135deg,rgba(74,222,128,.1),rgba(34,197,94,.06))', border: '1px solid rgba(74,222,128,.3)', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ fontWeight: 900, fontSize: 13, color: '#4ade80', marginBottom: 12 }}>💵 Incentives</div>
              {extras.incentives.map((inc, i) => (
                <div key={i} style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 6, paddingBottom: 6, borderBottom: i < extras.incentives.length - 1 ? '1px solid rgba(74,222,128,.15)' : 'none' }}>
                  {inc}
                </div>
              ))}
            </div>
          )}

          {/* Hot Models */}
          {extras.hot_models?.length > 0 && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ fontWeight: 900, fontSize: 13, color: '#fb923c', marginBottom: 12 }}>🔥 Hot Models</div>
              {extras.hot_models.map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 13, color: '#e2e8f0' }}>
                  <span style={{ color: '#fb923c' }}>▶</span> {m}
                </div>
              ))}
            </div>
          )}

          {/* Quote of the Week */}
          {extras.quote && (
            <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ fontWeight: 900, fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>💬 Quote of the Week</div>
              <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, fontStyle: 'italic' }}>"{extras.quote}"</div>
              {extras.quote_author && <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>— {extras.quote_author}</div>}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
