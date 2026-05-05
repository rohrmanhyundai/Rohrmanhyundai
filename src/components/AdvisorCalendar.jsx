import React, { useState, useEffect } from 'react';
import { loadAdvisorNoteIndex, loadSchedules, loadWipData, loadAwaitingData, loadDashboardData } from '../utils/github';
import Chat from './Chat';
import TechChat from './TechChat';

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

// Keys that are OFF by default — must be explicitly granted in user pages settings
const DEFAULT_OFF_KEYS = new Set(['surveyReports']);

function canSee(pages, role, key) {
  if (role === 'admin' || (role || '').includes('manager')) return true;
  if (DEFAULT_OFF_KEYS.has(key)) {
    // Feature is off unless explicitly set to true in user's pages
    return !!(pages && pages[key] === true);
  }
  if (!pages) return true;
  return pages[key] !== false;
}

function AdvisorJobsPanel({ title, jobs, emptyText, showTech, loading, color, bg, border, onOpen }) {
  const dayAge = (iso) => {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  };
  return (
    <div style={{ marginTop: 16, background: bg, border: `1px solid ${border}`, borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 13, color, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>{loading ? '…' : `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`}</div>
      </div>
      {loading ? (
        <div style={{ color: '#64748b', fontSize: 13, padding: '10px 0' }}>Loading…</div>
      ) : jobs.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13, padding: '6px 0' }}>{emptyText}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {jobs.map((j, i) => {
            const age = dayAge(j.roDate);
            const ageColor = age == null ? '#64748b' : age >= 14 ? '#f87171' : age >= 7 ? '#fbbf24' : '#94a3b8';
            return (
              <div key={j.id || `${j.ro}-${i}`} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)',
                borderRadius: 8, padding: '8px 12px',
              }}>
                <div style={{ minWidth: 70, fontWeight: 800, color: '#e2e8f0', fontSize: 13 }}>{j.ro || '—'}</div>
                {showTech && (
                  <div style={{ minWidth: 80, fontSize: 11, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: .5 }}>{j.tech || ''}</div>
                )}
                <div style={{ flex: 1, fontSize: 13, color: '#cbd5e1', lineHeight: 1.4 }}>
                  {j.jobDesc || '—'}
                  {j.notes ? <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{j.notes}</div> : null}
                </div>
                {j.highPriority && <span style={{ fontSize: 10, fontWeight: 800, color: '#f87171', background: 'rgba(248,113,113,.15)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap', alignSelf: 'center' }}>HIGH</span>}
                {j.partsArrived === false && j.etaParts && <span style={{ fontSize: 10, color: '#fbbf24', whiteSpace: 'nowrap', alignSelf: 'center' }}>parts ETA {j.etaParts}</span>}
                {j.partsArrived === true && <span style={{ fontSize: 10, color: '#4ade80', whiteSpace: 'nowrap', alignSelf: 'center' }}>✓ parts in</span>}
                {age != null && <span style={{ fontSize: 11, color: ageColor, whiteSpace: 'nowrap', alignSelf: 'center', fontWeight: 700 }}>{age}d</span>}
                {onOpen && (
                  <button
                    onClick={() => onOpen(j)}
                    title="Open this RO in WIP"
                    style={{
                      alignSelf: 'center', whiteSpace: 'nowrap',
                      background: 'rgba(96,165,250,.18)', border: '1px solid rgba(96,165,250,.45)',
                      color: '#93c5fd', borderRadius: 6, padding: '4px 10px',
                      fontWeight: 800, fontSize: 11, cursor: 'pointer',
                    }}
                  >View / Edit</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdvisorCalendar({ ownAdvisor, viewingAdvisor, advisorList, onViewingChange, onSelectDay, onBack, onDocumentLibrary, onWorkSchedule, onTechSchedule, onAftermarketWarranty, onSurveyReports, onOriginalOwner, onWorkInProgress, onMyReports, refreshKey, userPages, currentRole, currentUser, chatUsers, techChatUsers }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [noteDates, setNoteDates] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [scheduleEvents, setScheduleEvents] = useState({}); // { 'YYYY-MM-DD': [{name, type}] }
  const [advisorWip, setAdvisorWip] = useState([]);
  const [advisorAwaiting, setAdvisorAwaiting] = useState([]);
  const [wipLoading, setWipLoading] = useState(false);
  const [roSearch, setRoSearch] = useState('');

  useEffect(() => {
    if (!viewingAdvisor) return;
    setWipLoading(true);
    const advUpper = viewingAdvisor.toUpperCase();
    const isManagerView = advUpper === 'SHAWN';
    Promise.all([
      loadDashboardData().then(d => {
        const techs = (d?.data?.technicians || []).map(t => t.name).filter(Boolean);
        return Promise.all(techs.map(t =>
          loadWipData(t).then(rows => (rows || []).map(r => ({ ...r, tech: t })))
        )).then(all => {
          const flat = all.flat();
          return isManagerView ? flat : flat.filter(r => (r.advisor || '').toUpperCase() === advUpper);
        });
      }).catch(() => []),
      loadAwaitingData().then(rows => isManagerView ? (rows || []) : (rows || []).filter(r => (r.advisor || '').toUpperCase() === advUpper)).catch(() => []),
    ]).then(([wip, awaiting]) => {
      // Defensive dedupe: a row should appear under at most one tech and at
      // most once per tech. If the data files got into a bad state (rows
      // copied across techs without removal), keep the first occurrence so
      // the manager view doesn't show ghosts.
      const seenIds = new Set();
      const seenRos = new Set();
      const cleanWip = [];
      for (const r of wip) {
        if (r.id && seenIds.has(r.id)) continue;
        const ro = (r.ro || '').trim();
        if (ro && seenRos.has(ro)) continue;
        if (r.id) seenIds.add(r.id);
        if (ro) seenRos.add(ro);
        cleanWip.push(r);
      }
      setAdvisorWip(cleanWip);
      setAdvisorAwaiting(awaiting);
    }).finally(() => setWipLoading(false));
  }, [viewingAdvisor, refreshKey]);

  useEffect(() => {
    loadSchedules().then(s => {
      if (!s) return;
      const events = {};
      for (const [name, days] of Object.entries(s)) {
        if (name === '__HOLIDAY__') {
          for (const [date, val] of Object.entries(days || {})) {
            if (val === 'holiday') {
              if (!events[date]) events[date] = [];
              events[date].push({ name: 'HOLIDAY', type: 'holiday' });
            }
          }
          continue;
        }
        for (const [date, val] of Object.entries(days || {})) {
          if (val === 'vacation' || val === 'training') {
            if (!events[date]) events[date] = [];
            events[date].push({ name, type: val });
          }
        }
      }
      setScheduleEvents(events);
    }).catch(() => {});
  }, [refreshKey]);
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
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">Appointment Prep Calendar</div>
          <div className="adv-sub">
            {isViewingOwn ? `${viewingAdvisor} (My Calendar)` : `Viewing: ${viewingAdvisor}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canSee(userPages, currentRole, 'documentLibrary') && (
            <button onClick={onDocumentLibrary} style={{ background: 'linear-gradient(180deg,rgba(110,231,249,.25),rgba(61,214,195,.18))', borderColor: 'rgba(110,231,249,.35)' }}>
              📁 Document Library
            </button>
          )}
          {canSee(userPages, currentRole, 'advisorRankBoard') && (
            <button
              onClick={() => { navigator.clipboard.writeText('infinitepursuit').catch(() => {}); window.open('https://dealerplateguy.github.io/Advisor-Rank-Board/', '_blank'); }}
              style={{ background: 'linear-gradient(180deg,rgba(251,191,36,.25),rgba(245,158,11,.18))', borderColor: 'rgba(251,191,36,.35)' }}
            >
              🏆 Advisor Rank Board
            </button>
          )}
          {canSee(userPages, currentRole, 'advisorSchedule') && (
            <button onClick={onWorkSchedule} style={{ background: 'linear-gradient(180deg,rgba(167,139,250,.25),rgba(139,92,246,.18))', borderColor: 'rgba(167,139,250,.35)' }}>
              📅 Advisor Schedule
            </button>
          )}
          {canSee(userPages, currentRole, 'techSchedule') && (
            <button onClick={onTechSchedule} style={{ background: 'linear-gradient(180deg,rgba(251,146,60,.25),rgba(249,115,22,.18))', borderColor: 'rgba(251,146,60,.35)' }}>
              🔧 Tech Schedule
            </button>
          )}
          {canSee(userPages, currentRole, 'aftermarketWarranty') && (
            <button onClick={onAftermarketWarranty} style={{ background: 'linear-gradient(180deg,rgba(52,211,153,.25),rgba(16,185,129,.18))', borderColor: 'rgba(52,211,153,.35)' }}>
              🛡 After Market Warranty
            </button>
          )}
          {canSee(userPages, currentRole, 'originalOwner') && onOriginalOwner && (
            <button onClick={onOriginalOwner} style={{ background: 'linear-gradient(180deg,rgba(251,191,36,.25),rgba(245,158,11,.18))', borderColor: 'rgba(251,191,36,.35)' }}>
              📋 Original Owner
            </button>
          )}
          {canSee(userPages, currentRole, 'surveyReports') && onSurveyReports && (
            <button onClick={onSurveyReports} style={{ background: 'linear-gradient(180deg,rgba(167,139,250,.25),rgba(139,92,246,.18))', borderColor: 'rgba(167,139,250,.35)' }}>
              📊 Survey Reports
            </button>
          )}
          {onMyReports && (
            <button onClick={onMyReports} style={{ background: 'linear-gradient(180deg,rgba(61,214,195,.25),rgba(110,231,249,.18))', borderColor: 'rgba(61,214,195,.35)' }}>
              📈 My Reports
            </button>
          )}
          {canSee(userPages, currentRole, 'workInProgress') && onWorkInProgress && (
            <button onClick={onWorkInProgress} style={{ background: 'linear-gradient(180deg,rgba(251,146,60,.25),rgba(249,115,22,.18))', borderColor: 'rgba(251,146,60,.35)' }}>
              🔧 Work in Progress
            </button>
          )}
          {canSee(userPages, currentRole, 'tireQuote') && (
            <button onClick={() => window.open('https://hyundaitirecenter.com/InitDealer?dealer=IN007', '_blank')} style={{ background: 'linear-gradient(180deg,rgba(74,222,128,.25),rgba(34,197,94,.18))', borderColor: 'rgba(74,222,128,.35)' }}>
              🛞 Tire Quote
            </button>
          )}
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
          <button
            key="SHAWN"
            className={`adv-advisor-tab${viewingAdvisor === 'SHAWN' ? ' adv-advisor-tab--active' : ''}`}
            onClick={() => onViewingChange('SHAWN')}
            title="Manager view — see all WIP and all jobs awaiting tech"
            style={{ background: viewingAdvisor === 'SHAWN' ? 'linear-gradient(180deg,rgba(244,114,182,.3),rgba(168,85,247,.2))' : undefined, borderColor: viewingAdvisor === 'SHAWN' ? 'rgba(244,114,182,.5)' : undefined }}
          >
            SHAWN
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, background: 'rgba(244,114,182,.25)', color: '#f9a8d4', borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle' }}>
              MGR
            </span>
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16, padding: '8px 16px 16px', overflow: 'hidden' }}>
        {/* Tech Chat — left */}
        <div style={{ width: 300, flexShrink: 0 }}>
          <TechChat
            currentUser={currentUser || ''}
            currentRole={currentRole}
            hasChatAccess={techChatUsers && techChatUsers.map(u => u.toUpperCase()).includes((currentUser || '').toUpperCase())}
          />
        </div>
        {/* Calendar — middle */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
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
                const events = scheduleEvents[dateStr] || [];
                const styleFor = (type) => {
                  if (type === 'holiday')  return { bg: 'rgba(244,114,182,.18)', border: 'rgba(244,114,182,.5)', color: '#f9a8d4', icon: '🎉' };
                  if (type === 'vacation') return { bg: 'rgba(74,222,128,.16)',  border: 'rgba(74,222,128,.45)',  color: '#86efac', icon: '🌴' };
                  if (type === 'training') return { bg: 'rgba(96,165,250,.16)', border: 'rgba(96,165,250,.45)',  color: '#93c5fd', icon: '📘' };
                  return { bg: 'rgba(148,163,184,.15)', border: 'rgba(148,163,184,.4)', color: '#cbd5e1', icon: '•' };
                };
                return (
                  <div
                    key={dateStr}
                    className={`adv-cal-day${isToday ? ' adv-today' : ''}${hasNotes ? ' adv-has-notes' : ''}`}
                    onClick={() => onSelectDay(dateStr)}
                  >
                    <span className="adv-day-num">{d}</span>
                    {hasNotes && <span className="adv-note-dot" title="Notes saved" />}
                    {events.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, alignItems: 'flex-start' }}>
                        {events.map((ev, j) => {
                          const s = styleFor(ev.type);
                          const label = ev.type === 'holiday'
                            ? '🎉 Holiday'
                            : `${s.icon} ${ev.name} ${ev.type === 'vacation' ? 'Vac' : 'Trng'}`;
                          return (
                            <span key={j} title={`${ev.name}: ${ev.type}`} style={{
                              fontSize: 9.5, fontWeight: 700, color: s.color,
                              background: s.bg, border: `1px solid ${s.border}`,
                              borderRadius: 4, padding: '1px 5px', lineHeight: 1.3,
                              maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{label}</span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {loading && <div className="adv-loading">Loading saved notes...</div>}
          </div>

          {/* RO search */}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={roSearch}
              onChange={e => setRoSearch(e.target.value)}
              placeholder={viewingAdvisor === 'SHAWN' ? '🔍 Search RO # across all WIP and awaiting…' : `🔍 Search RO # in ${viewingAdvisor}'s WIP and awaiting…`}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none',
              }}
            />
            {roSearch && (
              <button onClick={() => setRoSearch('')} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: '#94a3b8', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Clear
              </button>
            )}
          </div>

          {/* No-match banner: offer to add RO via WIP page */}
          {roSearch.trim() && !wipLoading && (() => {
            const q = roSearch.trim().toLowerCase();
            const wipHits = advisorWip.filter(j => (j.ro || '').toLowerCase().includes(q)).length;
            const awHits  = advisorAwaiting.filter(j => (j.ro || '').toLowerCase().includes(q)).length;
            if (wipHits + awHits > 0) return null;
            return (
              <div style={{ marginTop: 10, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ color: '#fbbf24', fontSize: 13, fontWeight: 700 }}>
                  No matches for "{roSearch.trim()}". Open the WIP page to add this RO.
                </div>
                {onWorkInProgress && (
                  <button onClick={() => onWorkInProgress(roSearch.trim())} style={{ background: 'rgba(251,146,60,.25)', border: '1px solid rgba(251,146,60,.5)', color: '#fb923c', borderRadius: 8, padding: '8px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                    + Add RO in WIP
                  </button>
                )}
              </div>
            );
          })()}

          {/* Advisor WIP & Awaiting panels */}
          <AdvisorJobsPanel
            title={viewingAdvisor === 'SHAWN' ? 'All WIP (Manager View)' : `${viewingAdvisor}'s WIP`}
            emptyText={viewingAdvisor === 'SHAWN' ? 'No active WIPs in the shop.' : 'No active WIPs assigned to this advisor.'}
            jobs={roSearch.trim() ? advisorWip.filter(j => (j.ro || '').toLowerCase().includes(roSearch.trim().toLowerCase())) : advisorWip}
            showTech
            loading={wipLoading}
            color="#3dd6c3"
            bg="rgba(61,214,195,.06)"
            border="rgba(61,214,195,.25)"
            onOpen={onWorkInProgress ? (j) => onWorkInProgress({ ro: j.ro || '', tech: j.tech || '', source: 'wip' }) : undefined}
          />
          <AdvisorJobsPanel
            title={viewingAdvisor === 'SHAWN' ? 'All Cars Waiting on Tech' : 'Waiting on Tech'}
            emptyText={viewingAdvisor === 'SHAWN' ? 'No cars currently waiting on a tech.' : 'No jobs waiting on a tech for this advisor.'}
            jobs={roSearch.trim() ? advisorAwaiting.filter(j => (j.ro || '').toLowerCase().includes(roSearch.trim().toLowerCase())) : advisorAwaiting}
            loading={wipLoading}
            color="#fbbf24"
            bg="rgba(251,191,36,.06)"
            border="rgba(251,191,36,.25)"
            onOpen={onWorkInProgress ? (j) => onWorkInProgress({ ro: j.ro || '', tech: '', source: 'awaiting' }) : undefined}
          />
        </div>
        {/* Advisor Chat — right */}
        <div style={{ width: 300, flexShrink: 0 }}>
          <Chat
            currentUser={currentUser || ''}
            currentRole={currentRole}
            hasChatAccess={chatUsers && chatUsers.map(u => u.toUpperCase()).includes((currentUser || '').toUpperCase())}
          />
        </div>
      </div>
    </div>
  );
}
