import React, { useState, useEffect } from 'react';
import { loadGithubFile } from '../utils/github';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${+m}/${+d}/${String(+y).slice(2)}`;
}

function weekOfYear(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const jan1 = new Date(y, 0, 1);
  return Math.ceil((Math.floor((date - jan1) / 86400000) + 1) / 7);
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
  const currentMonthKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  // Default to the current calendar month if we have data for it; otherwise the latest month available.
  const defaultMonth = monthKeys.includes(currentMonthKey) ? currentMonthKey : (monthKeys[0] || '');
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [showAllDays, setShowAllDays] = useState(false);

  useEffect(() => {
    if (monthKeys.length && !monthKeys.includes(selectedMonth)) setSelectedMonth(defaultMonth);
  }, [monthKeys.join(',')]);

  useEffect(() => { setShowAllDays(false); }, [selectedMonth]);

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
              {(() => {
                const RED = '#f87171';
                const ok = (v, goal) => v !== null && v !== undefined && v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) >= goal;
                const c = (v, goal, base) => ok(v, goal) ? base : RED;
                return <>
                  <StatBox label="CSI · Goal 920"             value={latest?.csi || '—'}            color={c(latest?.csi, 920, '#4ade80')} />
                  <StatBox label="Hrs/RO · Goal 1.4"          value={num(latest?.hours_per_ro, 2)}  color={c(latest?.hours_per_ro, 1.4, '#6ee7f9')} />
                  <StatBox label="Roh$50 Hrs/RO · Goal 1.2"   value={num(latest?.roh50_hrs_ro, 2)}  color={c(latest?.roh50_hrs_ro, 1.2, '#6ee7f9')} />
                  <StatBox label="MTD Hrs · Goal 300"         value={num(latest?.mtd_hours, 1)}     color={c(latest?.mtd_hours, 300, '#6ee7f9')} />
                  <StatBox label="Daily Avg"                  value={num(latest?.daily_avg, 2)}     color="#c4b5fd" />
                  <StatBox label="Alignment · Goal 10%"       value={pct(latest?.align)}            color={c(latest?.align, 0.10, '#fbbf24')} />
                  <StatBox label="Tires · Goal 15%"           value={pct(latest?.tires)}            color={c(latest?.tires, 0.15, '#fbbf24')} />
                  <StatBox label="Valvoline · Goal 25%"       value={pct(latest?.valvoline)}        color={c(latest?.valvoline, 0.25, '#fbbf24')} />
                  <StatBox label="ASR · Goal 21%"             value={pct(latest?.asr)}              color={c(latest?.asr, 0.21, '#fdba74')} />
                  <StatBox label="ELR · Goal 88%"             value={pct(latest?.elr)}              color={c(latest?.elr, 0.88, '#fdba74')} />
                </>;
              })()}
            </div>
          </div>

          {/* Daily breakdown table */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>
              Daily Breakdown — {monthEntries.length} snapshot{monthEntries.length !== 1 ? 's' : ''} this month
            </div>
            {monthEntries.length > 1 && (
              <button onClick={() => setShowAllDays(s => !s)} style={{
                background: showAllDays ? 'rgba(61,214,195,.18)' : 'rgba(61,214,195,.08)',
                border: '1px solid rgba(61,214,195,.35)',
                color: '#3dd6c3', borderRadius: 8, padding: '6px 14px',
                fontWeight: 800, fontSize: 12, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: .5,
              }}>
                {showAllDays ? '▲ Show Latest Only' : `▼ Show All ${monthEntries.length} Days`}
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="adv-table" style={{ minWidth: 1200, tableLayout: 'auto' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>DATE</th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>CSI<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 920</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>HRS/RO<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 1.4</span></th>
                  <th style={{ minWidth: 110 }}>ROH$50<br />HRS/RO<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 1.2</span></th>
                  <th style={{ minWidth: 100, whiteSpace: 'nowrap' }}>MTD HRS<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 300</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>DAILY AVG</th>
                  <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>ALIGNMENT<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 10%</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>TIRES<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 15%</span></th>
                  <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>VALVOLINE<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 25%</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>ASR<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 21%</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>ELR<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 88%</span></th>
                </tr>
              </thead>
              <tbody>
                {(showAllDays ? monthEntries : monthEntries.slice(0, 1)).map((e, i) => {
                  const prev = monthEntries[i + 1];
                  return (
                    <tr key={i} style={{ background: i === 0 ? 'rgba(61,214,195,.04)' : '' }}>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip', color: '#94a3b8', fontWeight: i === 0 ? 700 : 400, minWidth: 110 }}>
                        {fmtShort(e.date)}
                        {i === 0 && <div style={{ fontSize: 9, color: '#3dd6c3', fontWeight: 800, marginTop: 2 }}>LATEST</div>}
                      </td>
                      <td style={{ color: '#4ade80', fontWeight: 700 }}>
                        {e.csi || '—'}<TrendIcon curr={e.csi} prev={prev?.csi} />
                      </td>
                      <td>{num(e.hours_per_ro, 2)}<TrendIcon curr={e.hours_per_ro} prev={prev?.hours_per_ro} /></td>
                      <td>{num(e.roh50_hrs_ro, 2)}<TrendIcon curr={e.roh50_hrs_ro} prev={prev?.roh50_hrs_ro} /></td>
                      <td style={{ color: '#6ee7f9' }}>{num(e.mtd_hours, 1)}<TrendIcon curr={e.mtd_hours} prev={prev?.mtd_hours} /></td>
                      <td>{num(e.daily_avg, 2)}<TrendIcon curr={e.daily_avg} prev={prev?.daily_avg} /></td>
                      <td>{pct(e.align)}<TrendIcon curr={e.align} prev={prev?.align} /></td>
                      <td>{pct(e.tires)}<TrendIcon curr={e.tires} prev={prev?.tires} /></td>
                      <td>{pct(e.valvoline)}<TrendIcon curr={e.valvoline} prev={prev?.valvoline} /></td>
                      <td>{pct(e.asr)}<TrendIcon curr={e.asr} prev={prev?.asr} /></td>
                      <td>{pct(e.elr)}<TrendIcon curr={e.elr} prev={prev?.elr} /></td>
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
// EFFICIENCY GAUGE SVG
// ─────────────────────────────────────────────────────────────
function EfficiencyGauge({ label, pct, sub, accentA, accentB }) {
  const noData   = isNaN(pct) || pct === null || pct === undefined;
  const p        = Math.max(0, Math.min(1.2, noData ? 0 : pct));
  const angle    = Math.PI * (1 - p / 1.2);
  const nx       = 110 + 72 * Math.cos(angle);
  const ny       = 100 - 72 * Math.sin(angle);
  const needleColor = noData ? '#334155' : p >= 1 ? '#4ade80' : p >= 0.8 ? '#fbbf24' : '#f87171';
  const glowColor   = noData ? 'transparent' : p >= 1 ? 'rgba(74,222,128,.35)' : p >= 0.8 ? 'rgba(251,191,36,.35)' : 'rgba(248,113,113,.35)';
  const total    = Math.PI * 78;
  const prog     = total * (p / 1.2);
  const pctLabel = noData ? '—' : (pct * 100).toFixed(1) + '%';
  const gid      = `gg-${label.replace(/\s+/g,'')}`;

  // Tick marks at 0, 25, 50, 75, 100, 120%
  const ticks = [0, 0.25, 0.5, 0.75, 1.0, 1.2].map(v => {
    const a = Math.PI * (1 - v / 1.2);
    const r1 = 85, r2 = 92;
    return {
      x1: 110 + r1 * Math.cos(a), y1: 100 - r1 * Math.sin(a),
      x2: 110 + r2 * Math.cos(a), y2: 100 - r2 * Math.sin(a),
      label: (v * 100) + '%',
      lx: 110 + 104 * Math.cos(a), ly: 100 - 104 * Math.sin(a),
    };
  });

  return (
    <div style={{
      flex: 1, minWidth: 200,
      background: `linear-gradient(145deg, rgba(15,23,42,0.95), rgba(15,23,42,0.8))`,
      border: `1px solid ${accentA}33`,
      borderRadius: 20,
      padding: '20px 16px 16px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      boxShadow: `0 0 32px ${accentA}18, inset 0 1px 0 rgba(255,255,255,.06)`,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Background glow blob */}
      <div style={{ position: 'absolute', top: -30, left: '50%', transform: 'translateX(-50%)', width: 160, height: 160, borderRadius: '50%', background: `radial-gradient(circle, ${accentA}18 0%, transparent 70%)`, pointerEvents: 'none' }} />

      <div style={{ fontSize: 10, fontWeight: 800, color: accentA, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10, zIndex: 1 }}>{label}</div>

      <svg viewBox="0 -14 220 134" style={{ width: '100%', maxWidth: 220, zIndex: 1 }}>
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={accentA} />
            <stop offset="100%" stopColor={accentB} />
          </linearGradient>
          <filter id={`glow-${gid}`}>
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id={`nglow-${gid}`}>
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Track background */}
        <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="16" strokeLinecap="round" />
        {/* Inner shadow track */}
        <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke="rgba(0,0,0,.4)" strokeWidth="18" strokeLinecap="round" />
        <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="14" strokeLinecap="round" />

        {/* Progress arc */}
        {!noData && (
          <>
            <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke={`url(#${gid})`} strokeWidth="14" strokeLinecap="round"
              strokeDasharray={`${prog} ${total}`} filter={`url(#glow-${gid})`} opacity="0.5" />
            <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke={`url(#${gid})`} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${prog} ${total}`} />
          </>
        )}

        {/* Tick marks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="rgba(255,255,255,.2)" strokeWidth={i === 4 ? 2 : 1} />
            <text x={t.lx} y={t.ly + 3} fill="rgba(255,255,255,.25)" fontSize="8" textAnchor="middle">{t.label}</text>
          </g>
        ))}

        {/* Needle glow */}
        {!noData && <line x1="110" y1="100" x2={nx} y2={ny} stroke={glowColor} strokeWidth="12" strokeLinecap="round" />}
        {/* Needle */}
        <line x1="110" y1="100" x2={nx} y2={ny} stroke={needleColor} strokeWidth="4" strokeLinecap="round" filter={!noData ? `url(#nglow-${gid})` : undefined} />
        {/* Hub */}
        <circle cx="110" cy="100" r="10" fill="#0f172a" stroke={noData ? '#334155' : accentA} strokeWidth="2" />
        <circle cx="110" cy="100" r="5" fill={needleColor} />
      </svg>

      {/* Big number */}
      <div style={{ fontSize: 32, fontWeight: 900, color: noData ? '#334155' : needleColor, marginTop: -4, lineHeight: 1,
        textShadow: noData ? 'none' : `0 0 20px ${glowColor}` }}>
        {pctLabel}
      </div>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 6, textAlign: 'center', lineHeight: 1.4 }}>{sub}</div>
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

  // ── Efficiency gauge calculations ──────────────────────────
  const allSorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Current week: latest entry
  const weekPct = latest ? parseFloat(latest.goal_pct) : NaN;

  // Current month: average goal_pct of entries whose weekStart falls in the current month
  const now = new Date();
  const curMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthEntries = allSorted.filter(e => (e.weekStart || e.date || '').startsWith(curMonthKey));
  const monthPct = monthEntries.length
    ? monthEntries.reduce((s, e) => s + (parseFloat(e.goal_pct) || 0), 0) / monthEntries.length
    : NaN;

  // 3-month rolling: entries from the last 13 weeks (~3 months)
  const threeMonthEntries = allSorted.slice(0, 13);
  const threeMonthPct = threeMonthEntries.length
    ? threeMonthEntries.reduce((s, e) => s + (parseFloat(e.goal_pct) || 0), 0) / threeMonthEntries.length
    : NaN;

  return (
    <div>
      {/* Efficiency Gauges */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <EfficiencyGauge
          label="Current Week"
          pct={weekPct}
          sub={latest ? (latest.label || fmtDate(latest.date)) : 'No data'}
          accentA="#3dd6c3"
          accentB="#6ee7f9"
        />
        <EfficiencyGauge
          label="This Month"
          pct={monthPct}
          sub={monthEntries.length ? `${monthEntries.length} week${monthEntries.length !== 1 ? 's' : ''} averaged` : 'No data this month'}
          accentA="#a78bfa"
          accentB="#c4b5fd"
        />
        <EfficiencyGauge
          label="Last 3 Months"
          pct={threeMonthPct}
          sub={threeMonthEntries.length ? `${threeMonthEntries.length} week${threeMonthEntries.length !== 1 ? 's' : ''} averaged` : 'No data'}
          accentA="#f97316"
          accentB="#fbbf24"
        />
      </div>

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
            <tbody>
              {filtered.map((e, i) => {
                const prev = filtered[i + 1];
                const gp   = parseFloat(e.goal_pct);

                // Dates for each day column, derived from this row's weekStart
                const dayD = (offset) => {
                  if (!e.weekStart) return '';
                  const d = new Date(e.weekStart + 'T00:00:00');
                  d.setDate(d.getDate() + offset);
                  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                };

                const DayCell = ({ val }) => (
                  <td style={{ color: '#94a3b8', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {num(val, 1)}
                  </td>
                );

                // Header row showing day names + this row's dates
                const headerRow = (
                  <tr>
                    <th style={{ whiteSpace: 'nowrap' }}>DATE</th>
                    <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>WEEK</th>
                    <th>TOTAL HRS</th>
                    <th>GOAL</th>
                    <th>GOAL %</th>
                    <th>PACING</th>
                    {[['SAT',0],['MON',2],['TUE',3],['WED',4],['THU',5],['FRI',6]].map(([day, offset]) => (
                      <th key={day} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {day}{e.weekStart ? <span style={{ marginLeft: 5, fontWeight: 400, color: '#64748b', fontSize: 11 }}>{dayD(offset)}</span> : null}
                      </th>
                    ))}
                  </tr>
                );

                return (
                  <React.Fragment key={i}>
                  {headerRow}
                  <tr style={{ background: i === 0 ? 'rgba(61,214,195,.04)' : '' }}>
                    <td style={{ whiteSpace: 'nowrap', color: '#94a3b8', fontSize: 12 }}>
                      {e.weekStart && e.weekEnd
                        ? <>{fmtShort(e.weekStart)} – {fmtShort(e.weekEnd)}</>
                        : fmtDate(e.date)}
                      {i === 0 && <span style={{ marginLeft: 6, fontSize: 10, color: '#3dd6c3', fontWeight: 800 }}>LATEST</span>}
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap', color: '#6ee7f9', fontWeight: 700, fontSize: 12 }}>
                      Wk {weekOfYear(e.weekStart)}
                      {e.vacationHours > 0 && <span title={`Includes ${e.vacationHours}h vacation`} style={{ marginLeft: 5, fontSize: 10, color: '#60a5fa' }}>🏖</span>}
                      {e.trainingHours > 0 && <span title={`Includes ${e.trainingHours}h training`} style={{ marginLeft: 4, fontSize: 10, color: '#a78bfa' }}>📚</span>}
                      {e.holidayHours  > 0 && <span title={`Includes ${e.holidayHours}h holiday`}  style={{ marginLeft: 4, fontSize: 10, color: '#fbbf24' }}>🎉</span>}
                    </td>
                    <td style={{ fontWeight: 700, color: '#4ade80' }}>
                      {num(e.total, 1)}<TrendIcon curr={e.total} prev={prev?.total} />
                    </td>
                    <td style={{ color: '#6ee7f9' }}>{num(e.goal, 1)}</td>
                    <td style={{ fontWeight: 700, color: gp >= 1 ? '#4ade80' : gp >= .8 ? '#fbbf24' : '#f87171' }}>
                      {pct(e.goal_pct)}<TrendIcon curr={e.goal_pct} prev={prev?.goal_pct} />
                    </td>
                    <td style={{ color: '#c4b5fd' }}>{num(e.pacing, 1)}</td>
                    <DayCell val={e.sat} />
                    <DayCell val={e.mon} />
                    <DayCell val={e.tue} />
                    <DayCell val={e.wed} />
                    <DayCell val={e.thu} />
                    <DayCell val={e.fri} />
                  </tr>
                  </React.Fragment>
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
