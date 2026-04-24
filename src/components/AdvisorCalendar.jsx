import React, { useState, useEffect } from 'react';
import { loadAdvisorNoteIndex } from '../utils/github';

const RANK_BASE = 'https://dealerplateguy.github.io/Advisor-Rank-Board/data';
const METRIC_KEYS = ['ro', 'openRo', 'cpHrs', 'warrHrs', 'rap', '_combined', 'alignCnt', 'tireCnt', 'valvCnt'];
const INVERSE_KEYS = new Set(['openRo']);

function computeRanks(advisors, csiAdvisors) {
  if (!advisors || advisors.length === 0) return {};
  const csiSet = new Set(csiAdvisors.map(n => String(n).toUpperCase()));
  const rows = advisors.map(a => ({
    ...a,
    _totalHrs: (a.cpHrs || 0) + (a.warrHrs || 0),
    _combined: (a.alignCnt || 0) + (a.tireCnt || 0) + (a.valvCnt || 0),
    _rp: {},
  }));

  // Assign percentile rank for each metric (average rank on ties)
  METRIC_KEYS.forEach(key => {
    const sorted = [...rows].sort((a, b) => {
      const av = key === '_combined' ? a._combined : (a[key] || 0);
      const bv = key === '_combined' ? b._combined : (b[key] || 0);
      return INVERSE_KEYS.has(key) ? av - bv : bv - av;
    });
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      const val = key === '_combined' ? sorted[i]._combined : (sorted[i][key] || 0);
      while (j < sorted.length && (key === '_combined' ? sorted[j]._combined : (sorted[j][key] || 0)) === val) j++;
      const avgRank = (sorted.length - i + sorted.length - j + 1) / 2;
      for (let k = i; k < j; k++) sorted[k]._rp[key] = Math.round(avgRank * 10) / 10;
      i = j;
    }
  });

  rows.forEach(a => {
    const total = METRIC_KEYS.reduce((sum, k) => sum + (a._rp[k] || 0), 0);
    const bonus = a.sunbitApps || 0;
    const csiPass = csiSet.has(String(a.name || '').toUpperCase());
    a._rankScore = Math.round(csiPass ? (total + bonus) * 1.1 : total + bonus);
  });

  const sorted = [...rows].sort((a, b) =>
    b._rankScore !== a._rankScore ? b._rankScore - a._rankScore :
    b._totalHrs !== a._totalHrs ? b._totalHrs - a._totalHrs :
    (a.openRo || 0) - (b.openRo || 0)
  );

  const rankMap = {};
  sorted.forEach((a, i) => { rankMap[String(a.name).toUpperCase()] = i + 1; });
  return rankMap;
}

function useRankBoard() {
  const [ranks, setRanks] = useState({});
  const [total, setTotal] = useState(0);
  useEffect(() => {
    Promise.all([
      fetch(`${RANK_BASE}/advisors.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()),
      fetch(`${RANK_BASE}/config.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()),
    ]).then(([advisors, config]) => {
      const csiAdvisors = (config.advisors || []).filter(a => a.csi === 'Y').map(a => a.name);
      setTotal(advisors.length);
      setRanks(computeRanks(advisors, csiAdvisors));
    }).catch(() => {});
  }, []);
  return { ranks, total };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function AdvisorCalendar({ ownAdvisor, viewingAdvisor, advisorList, onViewingChange, onSelectDay, onBack, onDocumentLibrary, onWorkSchedule, onTechSchedule, refreshKey }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [noteDates, setNoteDates] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const { ranks, total } = useRankBoard();

  useEffect(() => {
    setLoading(true);
    loadAdvisorNoteIndex(viewingAdvisor).then(dates => {
      setNoteDates(new Set(dates));
      setLoading(false);
    });
  }, [viewingAdvisor, refreshKey]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isViewingOwn = viewingAdvisor === ownAdvisor;

  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <div>
          <div className="adv-title">Appointment Prep Calendar</div>
          <div className="adv-sub">
            {isViewingOwn ? `${viewingAdvisor} (My Calendar)` : `Viewing: ${viewingAdvisor}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onDocumentLibrary} style={{ background: 'linear-gradient(180deg,rgba(110,231,249,.25),rgba(61,214,195,.18))', borderColor: 'rgba(110,231,249,.35)' }}>
            📁 Document Library
          </button>
          <button
            onClick={() => window.open('https://dealerplateguy.github.io/Advisor-Rank-Board/', '_blank')}
            style={{ background: 'linear-gradient(180deg,rgba(251,191,36,.25),rgba(245,158,11,.18))', borderColor: 'rgba(251,191,36,.35)' }}
          >
            🏆 Advisor Rank Board
          </button>
          <button onClick={onWorkSchedule} style={{ background: 'linear-gradient(180deg,rgba(167,139,250,.25),rgba(139,92,246,.18))', borderColor: 'rgba(167,139,250,.35)' }}>
            📅 Advisor Schedule
          </button>
          <button onClick={onTechSchedule} style={{ background: 'linear-gradient(180deg,rgba(251,146,60,.25),rgba(249,115,22,.18))', borderColor: 'rgba(251,146,60,.35)' }}>
            🔧 Tech Schedule
          </button>
          <button className="secondary" onClick={onBack}>← Service Operations Dashboard</button>
        </div>
      </div>

      {/* Advisor switcher tabs */}
      {advisorList.length > 0 && (
        <div className="adv-advisor-tabs">
          {advisorList.map(name => {
            const upper = name.toUpperCase();
            // Exact match first, then fall back to matching by first name
            // (tab shows "JORDAN" but rank board stores "JORDAN TROXEL")
            const rank = ranks[upper] ??
              (Object.entries(ranks).find(([k]) => k.startsWith(upper + ' '))?.[1]);
            const rankColor = rank === 1 ? '#fbbf24' : rank === 2 ? '#94a3b8' : rank === 3 ? '#cd7c3a' : 'rgba(148,163,184,0.5)';
            return (
              <button
                key={name}
                className={`adv-advisor-tab${viewingAdvisor === name ? ' adv-advisor-tab--active' : ''}${name === ownAdvisor ? ' adv-advisor-tab--own' : ''}`}
                onClick={() => onViewingChange(name)}
              >
                {name}
                {name === ownAdvisor && <span className="adv-tab-mine"> (Mine)</span>}
                {rank && (
                  <span style={{
                    marginLeft: 6, fontSize: 10, fontWeight: 700,
                    background: rankColor, color: rank <= 3 ? '#111' : '#cdd6e8',
                    borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle',
                  }}>
                    #{rank}{total ? ` / ${total}` : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="adv-cal-wrap">
        <div className="adv-cal-nav">
          <button className="secondary adv-nav-btn" onClick={prevMonth}>‹</button>
          <span className="adv-cal-month">{MONTH_NAMES[month]} {year}</span>
          <button className="secondary adv-nav-btn" onClick={nextMonth}>›</button>
        </div>

        <div className="adv-cal-grid">
          {DAY_NAMES.map(d => (
            <div key={d} className="adv-cal-dayname">{d}</div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={`empty-${i}`} className="adv-cal-day adv-cal-empty" />;
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const isToday = dateStr === todayStr;
            const hasNotes = noteDates.has(dateStr);
            return (
              <div
                key={dateStr}
                className={`adv-cal-day${isToday ? ' adv-today' : ''}${hasNotes ? ' adv-has-notes' : ''}`}
                onClick={() => onSelectDay(dateStr)}
              >
                <span className="adv-day-num">{d}</span>
                {hasNotes && <span className="adv-note-dot" title="Notes saved" />}
              </div>
            );
          })}
        </div>

        {loading && <div className="adv-loading">Loading saved notes...</div>}
      </div>
    </div>
  );
}
