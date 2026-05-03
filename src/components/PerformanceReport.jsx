import React, { useState, useEffect } from 'react';
import { loadGithubFile } from '../utils/github';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function pct(val) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return (n * 100).toFixed(1) + '%';
}

function num(val, decimals = 1) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(decimals);
}

function StatBox({ label, value, color = '#6ee7f9' }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 18px', minWidth: 100, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>{label}</div>
    </div>
  );
}

function TrendIcon({ curr, prev, higher = true }) {
  if (prev === undefined || prev === null || curr === undefined || curr === null) return null;
  const a = parseFloat(curr), b = parseFloat(prev);
  if (isNaN(a) || isNaN(b) || a === b) return null;
  const up = a > b;
  const good = higher ? up : !up;
  return <span style={{ marginLeft: 4, fontSize: 11, color: good ? '#4ade80' : '#f87171' }}>{up ? '▲' : '▼'}</span>;
}

// ─────────────────────────────────────────────────────────────
// ADVISOR VIEW — daily snapshots grouped by month
// ─────────────────────────────────────────────────────────────
function AdvisorReport({ entries }) {
  // Collect unique months from entries
  const monthKeys = [...new Set(entries.map(e => e.month || e.date?.slice(0, 7)).filter(Boolean))].sort().reverse();
  const [selectedMonth, setSelectedMonth] = useState(monthKeys[0] || '');

  useEffect(() => {
    if (monthKeys.length && !monthKeys.includes(selectedMonth)) setSelectedMonth(monthKeys[0]);
  }, [monthKeys.join(',')]);

  const monthEntries = entries
    .filter(e => (e.month || e.date?.slice(0, 7)) === selectedMonth)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const latest = monthEntries[0];

  const [yr, mo] = selectedMonth ? selectedMonth.split('-') : ['', ''];
  const monthLabel = yr && mo ? `${MONTHS[parseInt(mo) - 1]} ${yr}` : selectedMonth;

  return (
    <div>
      {/* Month selector */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Select Month</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {monthKeys.map(mk => {
            const [y, m] = mk.split('-');
            const lbl = `${MONTHS[parseInt(m)-1].slice(0,3)} ${y}`;
            return (
              <button key={mk} onClick={() => setSelectedMonth(mk)} style={{
                background: selectedMonth === mk ? 'rgba(61,214,195,.2)' : 'rgba(255,255,255,.05)',
                border: `1px solid ${selectedMonth === mk ? 'rgba(61,214,195,.4)' : 'rgba(255,255,255,.1)'}`,
                color: selectedMonth === mk ? '#6ee7f9' : '#64748b',
                borderRadius: 8, padding: '5px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
              }}>{lbl}</button>
            );
          })}
        </div>
      </div>

      {!selectedMonth || monthEntries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>No entries for this month.</div>
      ) : (
        <>
          {/* Month summary — latest snapshot */}
          <div style={{ background: 'linear-gradient(135deg,rgba(61,214,195,.1),rgba(110,231,249,.06))', border: '1px solid rgba(61,214,195,.25)', borderRadius: 16, padding: '18px 22px', marginBottom: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              📌 {monthLabel} — Latest ({fmtDate(latest?.date)})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <StatBox label="CSI"        value={latest?.csi || '—'}          color="#4ade80" />
              <StatBox label="Hrs/RO"     value={num(latest?.hours_per_ro, 2)} color="#6ee7f9" />
              <StatBox label="MTD Hrs"    value={num(latest?.mtd_hours, 1)}    color="#6ee7f9" />
              <StatBox label="Daily Avg"  value={num(latest?.daily_avg, 2)}    color="#c4b5fd" />
              <StatBox label="Alignment"  value={pct(latest?.align)}           color="#fbbf24" />
              <StatBox label="Tires"      value={pct(latest?.tires)}           color="#fbbf24" />
              <StatBox label="Valvoline"  value={pct(latest?.valvoline)}       color="#fbbf24" />
              <StatBox label="ASR"        value={pct(latest?.asr)}             color="#fdba74" />
              <StatBox label="ELR"        value={num(latest?.elr, 2)}          color="#fdba74" />
            </div>
          </div>

          {/* Daily breakdown table */}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Daily Breakdown — {monthEntries.length} snapshot{monthEntries.length !== 1 ? 's' : ''} this month
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="adv-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>CSI</th>
                  <th>HRS/RO</th>
                  <th>MTD HRS</th>
                  <th>DAILY AVG</th>
                  <th>ALIGNMENT</th>
                  <th>TIRES</th>
                  <th>VALVOLINE</th>
                  <th>ASR</th>
                  <th>ELR</th>
                </tr>
              </thead>
              <tbody>
                {monthEntries.map((e, i) => {
                  const prev = monthEntries[i + 1];
                  return (
                    <tr key={i} style={{ background: i === 0 ? 'rgba(61,214,195,.04)' : '' }}>
                      <td style={{ whiteSpace: 'nowrap', color: '#94a3b8', fontWeight: i === 0 ? 700 : 400 }}>
                        {fmtDate(e.date)}{i === 0 && <span style={{ marginLeft: 6, fontSize: 10, color: '#3dd6c3', fontWeight: 800 }}>LATEST</span>}
                      </td>
                      <td style={{ color: '#4ade80', fontWeight: 700 }}>
                        {e.csi || '—'}<TrendIcon curr={e.csi} prev={prev?.csi} />
                      </td>
                      <td>{num(e.hours_per_ro, 2)}<TrendIcon curr={e.hours_per_ro} prev={prev?.hours_per_ro} /></td>
                      <td style={{ color: '#6ee7f9' }}>{num(e.mtd_hours, 1)}<TrendIcon curr={e.mtd_hours} prev={prev?.mtd_hours} /></td>
                      <td>{num(e.daily_avg, 2)}<TrendIcon curr={e.daily_avg} prev={prev?.daily_avg} /></td>
                      <td>{pct(e.align)}<TrendIcon curr={e.align} prev={prev?.align} /></td>
                      <td>{pct(e.tires)}<TrendIcon curr={e.tires} prev={prev?.tires} /></td>
                      <td>{pct(e.valvoline)}<TrendIcon curr={e.valvoline} prev={prev?.valvoline} /></td>
                      <td>{pct(e.asr)}<TrendIcon curr={e.asr} prev={prev?.asr} /></td>
                      <td>{num(e.elr, 2)}<TrendIcon curr={e.elr} prev={prev?.elr} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TECH VIEW — weekly snapshots (Sat–Fri)
// ─────────────────────────────────────────────────────────────
function TechReport({ entries }) {
  // Group by year for filter
  const years = [...new Set(entries.map(e => e.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const [selectedYear, setSelectedYear] = useState(years[0] || String(new Date().getFullYear()));

  const filtered = entries
    .filter(e => e.date?.startsWith(selectedYear))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const latest = filtered[0];

  return (
    <div>
      {/* Year selector */}
      {years.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {years.map(y => (
            <button key={y} onClick={() => setSelectedYear(y)} style={{
              background: selectedYear === y ? 'rgba(61,214,195,.2)' : 'rgba(255,255,255,.05)',
              border: `1px solid ${selectedYear === y ? 'rgba(61,214,195,.4)' : 'rgba(255,255,255,.1)'}`,
              color: selectedYear === y ? '#6ee7f9' : '#64748b',
              borderRadius: 8, padding: '5px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
            }}>{y}</button>
          ))}
        </div>
      )}

      {/* Latest week highlight */}
      {latest && (
        <div style={{ background: 'linear-gradient(135deg,rgba(61,214,195,.1),rgba(110,231,249,.06))', border: '1px solid rgba(61,214,195,.25)', borderRadius: 16, padding: '18px 22px', marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            📌 Latest — {latest.label || fmtDate(latest.date)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <StatBox label="Total Hrs"  value={num(latest.total, 1)}    color="#4ade80" />
            <StatBox label="Goal"       value={num(latest.goal, 1)}     color="#6ee7f9" />
            <StatBox label="Goal %"     value={pct(latest.goal_pct)}    color={parseFloat(latest.goal_pct) >= 1 ? '#4ade80' : parseFloat(latest.goal_pct) >= .8 ? '#fbbf24' : '#f87171'} />
            <StatBox label="Pacing"     value={num(latest.pacing, 1)}   color="#c4b5fd" />
            <StatBox label="Mon"        value={num(latest.mon, 1)}      color="#94a3b8" />
            <StatBox label="Tue"        value={num(latest.tue, 1)}      color="#94a3b8" />
            <StatBox label="Wed"        value={num(latest.wed, 1)}      color="#94a3b8" />
            <StatBox label="Thu"        value={num(latest.thu, 1)}      color="#94a3b8" />
            <StatBox label="Fri"        value={num(latest.fri, 1)}      color="#94a3b8" />
            <StatBox label="Sat"        value={num(latest.sat, 1)}      color="#94a3b8" />
          </div>
        </div>
      )}

      {/* Weekly history table */}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
        Weekly History — {filtered.length} week{filtered.length !== 1 ? 's' : ''} in {selectedYear}
      </div>
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No entries for {selectedYear}.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="adv-table" style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th>WEEK</th>
                <th>TOTAL HRS</th>
                <th>GOAL</th>
                <th>GOAL %</th>
                <th>PACING</th>
                <th>SAT</th>
                <th>MON</th>
                <th>TUE</th>
                <th>WED</th>
                <th>THU</th>
                <th>FRI</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const prev = filtered[i + 1];
                const gp   = parseFloat(e.goal_pct);

                // Calculate the actual date for each day of the week (Sat=weekStart, Mon–Fri follow)
                const dayDates = (() => {
                  if (!e.weekStart) return {};
                  const sat = new Date(e.weekStart + 'T00:00:00');
                  const d = (offset) => {
                    const dt = new Date(sat);
                    dt.setDate(sat.getDate() + offset);
                    return dt.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                  };
                  return { sat: d(0), mon: d(2), tue: d(3), wed: d(4), thu: d(5), fri: d(6) };
                })();

                const DayCell = ({ val, dayKey }) => (
                  <td style={{ color: '#94a3b8', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {num(val, 1)}
                    {dayDates[dayKey] && <span style={{ fontSize: 10, color: '#475569', marginLeft: 5 }}>{dayDates[dayKey]}</span>}
                  </td>
                );

                return (
                  <tr key={i} style={{ background: i === 0 ? 'rgba(61,214,195,.04)' : '' }}>
                    <td style={{ whiteSpace: 'nowrap', color: '#94a3b8', fontSize: 12 }}>
                      {e.label || fmtDate(e.date)}
                      {i === 0 && <span style={{ marginLeft: 6, fontSize: 10, color: '#3dd6c3', fontWeight: 800 }}>LATEST</span>}
                      {e.vacationHours > 0 && <span title={`Includes ${e.vacationHours}h vacation`} style={{ marginLeft: 6, fontSize: 10, color: '#60a5fa', fontWeight: 800 }}>🏖 +{e.vacationHours}h</span>}
                      {e.trainingHours > 0 && <span title={`Includes ${e.trainingHours}h training`} style={{ marginLeft: 6, fontSize: 10, color: '#a78bfa', fontWeight: 800 }}>📚 +{e.trainingHours}h</span>}
                      {e.holidayHours  > 0 && <span title={`Includes ${e.holidayHours}h holiday`}  style={{ marginLeft: 6, fontSize: 10, color: '#fbbf24', fontWeight: 800 }}>🎉 +{e.holidayHours}h</span>}
                    </td>
                    <td style={{ fontWeight: 700, color: '#4ade80' }}>
                      {num(e.total, 1)}<TrendIcon curr={e.total} prev={prev?.total} />
                    </td>
                    <td style={{ color: '#6ee7f9' }}>{num(e.goal, 1)}</td>
                    <td style={{ fontWeight: 700, color: gp >= 1 ? '#4ade80' : gp >= .8 ? '#fbbf24' : '#f87171' }}>
                      {pct(e.goal_pct)}<TrendIcon curr={e.goal_pct} prev={prev?.goal_pct} />
                    </td>
                    <td style={{ color: '#c4b5fd' }}>{num(e.pacing, 1)}</td>
                    <DayCell val={e.sat} dayKey="sat" />
                    <DayCell val={e.mon} dayKey="mon" />
                    <DayCell val={e.tue} dayKey="tue" />
                    <DayCell val={e.wed} dayKey="wed" />
                    <DayCell val={e.thu} dayKey="thu" />
                    <DayCell val={e.fri} dayKey="fri" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
export default function PerformanceReport({ currentUser, role, onBack }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const username = (currentUser || '').toUpperCase();
  const isAdvisor = (role || '').toLowerCase() === 'advisor';
  const isTech    = (role || '').toLowerCase() === 'technician';

  useEffect(() => {
    setLoading(true);
    loadGithubFile(`data/performance-reports/${username}.json`)
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [username]);

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">📊 My Performance Reports</div>
          <div className="adv-sub">
            {username}
            {isAdvisor && ' · Daily snapshots by month'}
            {isTech    && ' · Weekly snapshots (Sat–Fri)'}
          </div>
        </div>
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#64748b' }}>⏳ Loading your reports…</div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
              <div style={{ fontWeight: 900, fontSize: 18, color: '#94a3b8', marginBottom: 8 }}>No Reports Yet</div>
              <div style={{ fontSize: 14, color: '#475569' }}>
                {isAdvisor
                  ? 'Your manager will send your first daily snapshot soon. Numbers are saved each time your manager clicks "Send to Reports".'
                  : 'Your manager will send your first weekly snapshot soon. Each week (Sat–Fri) gets its own entry.'}
              </div>
            </div>
          ) : isAdvisor ? (
            <AdvisorReport entries={entries} />
          ) : isTech ? (
            <TechReport entries={entries} />
          ) : (
            <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Role not recognized.</div>
          )}

        </div>
      </div>
    </div>
  );
}
