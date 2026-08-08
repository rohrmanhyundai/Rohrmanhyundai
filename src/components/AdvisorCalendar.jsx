import React, { useState, useEffect, useMemo } from 'react';
import { loadAdvisorNoteIndex, loadSchedules, loadWipData, saveWipData, loadAwaitingData, saveAwaitingData, loadDashboardData, appendRoArchive, loadAdvisorGoals, loadServiceInvitations, loadCompletedReviews } from '../utils/github';
import { pendingSurveysFor } from './AfterCallReport';
import { canonicalAdvisorFirst } from '../utils/advisorAliases';
import { advisorOffDates } from '../utils/calculations';
import { ensureMtd, dailyPacing } from '../utils/advisorGoals';
import Chat from './Chat';
import TechChat from './TechChat';
import PartsReceived, { canUsePartsReceived } from './PartsReceived';

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

function AdvisorJobsPanel({ title, jobs, emptyText, showTech, showAdvisor, loading, color, bg, border, onOpen, onDelete, deletingId, highlightAdvisor, canFlag, onFlag, flaggingId }) {
  // Match by first name so an RO stored as "JORDAN TROXEL" (from an upload) still
  // counts as JORDAN's and floats to the top for the logged-in advisor.
  const hl = (highlightAdvisor || '').toUpperCase().split(/\s+/)[0];
  const isMine = (j) => hl && canonicalAdvisorFirst(j.advisor) === hl;
  // HIGH-priority rows always rise to the very top of the list (even in the
  // manager view, which has no advisor highlight). When an advisor is viewing
  // their own board, their rows come next. Stable otherwise — a 0 return keeps
  // the incoming order, so nothing else is reshuffled.
  jobs = [...jobs].sort((a, b) => {
    const ah = a.highPriority ? 0 : 1, bh = b.highPriority ? 0 : 1;
    if (ah !== bh) return ah - bh;
    if (hl) {
      const am = isMine(a) ? 0 : 1, bm = isMine(b) ? 0 : 1;
      if (am !== bm) return am - bm;
    }
    return 0;
  });
  const dayAge = (iso) => {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  };
  const [copiedKey, setCopiedKey] = useState(null);
  const copyRo = (ro, key, e) => {
    e.stopPropagation();
    if (!ro) return;
    const done = () => { setCopiedKey(key); setTimeout(() => setCopiedKey(k => k === key ? null : k), 1200); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(ro).then(done).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = ro; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch {}
      document.body.removeChild(ta);
    }
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
            const mine = isMine(j);
            // When an advisor is viewing their board (hl set), their own rows
            // glow green and every OTHER advisor's row glows blue. Flagged rows
            // keep the pink "Needs Attention" look regardless. The manager view
            // (no hl) falls through to the default parts-in/neutral styling.
            const other = !!hl && !mine;
            const rowBase = { display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', borderRadius: 8, padding: '8px 12px' };
            const rowStyle = j.highPriority ? {
              ...rowBase,
              background: 'linear-gradient(135deg, rgba(239,68,68,.22) 0%, rgba(249,115,22,.12) 100%)',
              border: '2px solid rgba(248,113,113,.95)',
              borderLeft: '6px solid #ef4444',
            } : j.flagged ? {
              ...rowBase,
              background: 'linear-gradient(135deg, rgba(236,72,153,.18) 0%, rgba(219,39,119,.12) 100%)',
              border: '2px solid rgba(236,72,153,.95)',
              borderLeft: '5px solid rgba(236,72,153,1)',
            } : mine ? {
              ...rowBase,
              background: 'rgba(61,214,195,.10)',
              border: '1px solid rgba(61,214,195,.7)',
              boxShadow: '0 0 12px rgba(61,214,195,.45), inset 0 0 8px rgba(61,214,195,.15)',
            } : other ? {
              ...rowBase,
              background: 'rgba(59,130,246,.10)',
              border: '1px solid rgba(96,165,250,.7)',
              boxShadow: '0 0 12px rgba(59,130,246,.45), inset 0 0 8px rgba(59,130,246,.15)',
            } : {
              ...rowBase,
              background: j.partsArrived === true ? 'rgba(34,197,94,.07)' : 'rgba(255,255,255,.03)',
              border: j.partsArrived === true ? '1px solid rgba(34,197,94,.4)' : '1px solid rgba(255,255,255,.06)',
              borderLeft: j.partsArrived === true ? '4px solid rgba(34,197,94,.85)' : undefined,
              boxShadow: j.partsArrived === true ? '0 0 10px rgba(34,197,94,.25)' : 'none',
            };
            return (
              <div key={j.id || `${j.ro}-${i}`} className={j.highPriority ? 'attn-high-row' : j.flagged ? 'attn-flag-row' : undefined} style={rowStyle}>
                <div
                  onClick={(e) => copyRo(j.ro, j.id || `${j.ro}-${i}`, e)}
                  title={j.ro ? 'Click to copy RO #' : ''}
                  style={{ minWidth: 78, fontWeight: 800, color: copiedKey === (j.id || `${j.ro}-${i}`) ? '#4ade80' : '#e2e8f0', fontSize: 16, cursor: j.ro ? 'pointer' : 'default', userSelect: 'none' }}
                >{copiedKey === (j.id || `${j.ro}-${i}`) ? '✓ Copied' : (j.ro || '—')}</div>
                {showAdvisor && (
                  <div style={{ minWidth: 76, fontSize: 14, fontWeight: 800, color: '#6ee7f9', textTransform: 'uppercase', letterSpacing: .5 }}>{canonicalAdvisorFirst(j.advisor)}</div>
                )}
                {showTech && (
                  <div style={{ minWidth: 80, fontSize: 11, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: .5 }}>{String(j.tech || '').trim().split(/\s+/)[0]}</div>
                )}
                <div style={{ flex: 1, minWidth: 120, fontSize: 13, color: '#cbd5e1', lineHeight: 1.4 }}>
                  {j.jobDesc || '—'}
                  {j.notes ? <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{j.notes}</div> : null}
                </div>
                {j.highPriority && <span style={{ fontSize: 10, fontWeight: 900, color: '#fff', background: 'linear-gradient(135deg,#ef4444,#f97316)', border: '1px solid rgba(248,113,113,.6)', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap', alignSelf: 'center', letterSpacing: .6, textShadow: '0 0 6px rgba(239,68,68,.6)', boxShadow: '0 0 10px rgba(239,68,68,.5)' }}>⚠ HIGH</span>}
                {j.partsArrived === false && j.etaParts && <span style={{ fontSize: 10, color: '#fbbf24', whiteSpace: 'nowrap', alignSelf: 'center' }}>parts ETA {j.etaParts}</span>}
                {j.partsArrived === true && (
                  <span className="parts-in-pill" style={{ alignSelf: 'center' }}>
                    <span className="pip-icon">📦</span>Parts In{j.partsArrivedDate ? ` · ${j.partsArrivedDate}` : ''}
                  </span>
                )}
                {j.flagged && (
                  <span className="attn-flag-pill" style={{ alignSelf: 'center' }}>
                    <span className="aff-icon">🚩</span>Needs Attention
                  </span>
                )}
                {age != null && <span style={{ fontSize: 11, color: ageColor, whiteSpace: 'nowrap', alignSelf: 'center', fontWeight: 700 }}>{age}d</span>}
                {/* Keep the action buttons together and right-aligned so Delete is
                    always in the same spot on every row (not split by wrapping). */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0, alignSelf: 'center' }}>
                  {canFlag && onFlag && (
                    <button
                      onClick={() => onFlag(j)}
                      disabled={flaggingId === j.id}
                      title={j.flagged ? 'Remove attention flag' : 'Flag this RO for the advisor'}
                      className={`attn-flag-btn ${j.flagged ? 'attn-flag-btn--on' : 'attn-flag-btn--off'}`}
                      style={{ cursor: flaggingId === j.id ? 'wait' : 'pointer', opacity: flaggingId === j.id ? 0.6 : 1 }}
                    >{flaggingId === j.id ? '⏳' : (j.flagged ? '🚩 Unflag' : '🚩 Flag')}</button>
                  )}
                  {onOpen && (
                    <button
                      onClick={() => onOpen(j)}
                      title="Open this RO in WIP"
                      style={{
                        whiteSpace: 'nowrap',
                        background: 'rgba(96,165,250,.18)', border: '1px solid rgba(96,165,250,.45)',
                        color: '#93c5fd', borderRadius: 6, padding: '4px 10px',
                        fontWeight: 800, fontSize: 11, cursor: 'pointer',
                      }}
                    >View / Edit</button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => {
                        const label = j.ro ? `RO #${j.ro}` : 'this row';
                        if (!window.confirm(`Are you sure you want to delete ${label}? This cannot be undone.`)) return;
                        onDelete(j);
                      }}
                      disabled={deletingId === j.id}
                      title="Delete this RO"
                      style={{
                        whiteSpace: 'nowrap',
                        background: 'rgba(248,113,113,.15)', border: '1px solid rgba(248,113,113,.45)',
                        color: '#f87171', borderRadius: 6, padding: '4px 10px',
                        fontWeight: 800, fontSize: 11, cursor: deletingId === j.id ? 'wait' : 'pointer',
                        opacity: deletingId === j.id ? 0.6 : 1,
                      }}
                    >{deletingId === j.id ? '⏳' : '🗑 Delete'}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Non-Sunday working dates for a month, and YYYY-MM / YYYY-MM-DD keys — mirrors
// the helpers in AdvisorGoals so the missed-day pin uses identical day math.
function workingDatesCal(year, month) {
  const dim = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let d = 1; d <= dim; d++) if (new Date(year, month, d).getDay() !== 0) out.push(new Date(year, month, d));
  return out;
}
const dKeyCal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const monthKeyCal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Stale-while-revalidate cache for the WIP / awaiting lists so the page shows
// the last-known jobs instantly instead of a "Loading…" while the (many) per-tech
// GitHub reads complete in the background.
const WIP_CACHE_KEY = 'apc_wip_cache_v1';
function readWipCache() {
  try {
    const r = JSON.parse(localStorage.getItem(WIP_CACHE_KEY) || 'null');
    if (r && Array.isArray(r.wip) && Array.isArray(r.awaiting)) return r;
  } catch {}
  return null;
}
function writeWipCache(wip, awaiting) {
  try { localStorage.setItem(WIP_CACHE_KEY, JSON.stringify({ wip, awaiting })); } catch {}
}

export default function AdvisorCalendar({ ownAdvisor, viewingAdvisor, advisorList, onViewingChange, onSelectDay, onBack, onDocumentLibrary, onWorkSchedule, onTechSchedule, onAftermarketWarranty, onSurveyReports, onAfterCall, onOriginalOwner, onWorkInProgress, onRoUpload, onRepairOrderProcess, onMyReports, onHotRepairs, onGoalsForecasting, onServicePricing, onChargeList, onCashDash, refreshKey, userPages, currentRole, currentUser, chatUsers, techChatUsers, techNames = [], schedules = {}, vacations = [], advisors = [] }) {
  const today = new Date();
  // After 3pm Eastern, make the End of Day Reporting button pulse to grab the
  // advisor's attention. Ticks each minute so it flips on its own if left open.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNowTick(Date.now()), 60000); return () => clearInterval(id); }, []);
  const easternHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(nowTick)), 10) % 24;
  const eodUrgent = easternHour >= 15;

  // Daily pacing badge for TODAY's cell: from the viewed advisor's monthly Hours
  // Goal (Goals/Forecasting) and their MTD hours (the morning upload), figure how
  // many hours they need to sell today — to reach goal if behind pace, or to hold
  // their pace if ahead. Recomputes when the advisor / MTD / schedule changes.
  const [pacing, setPacing] = useState(null);
  const pacingAdv = (viewingAdvisor || '').toUpperCase().split(/\s+/)[0];
  // Primitive MTD so the effect only re-fires when the number changes, not on
  // every dashboard poll (which hands us a fresh `advisors` array reference).
  const pacingMtd = useMemo(() => {
    const rec = (advisors || []).find(a => (a.name || '').toUpperCase().split(/\s+/)[0] === pacingAdv);
    return rec ? Number(rec.mtd_hours) || 0 : 0;
  }, [advisors, pacingAdv]);
  useEffect(() => {
    if (!pacingAdv) { setPacing(null); return; }
    const now = new Date();
    const y = now.getFullYear(), mo = now.getMonth();
    let cancelled = false;
    (async () => {
      try {
        const all = await loadAdvisorGoals(pacingAdv);
        const mk = `${y}-${String(mo + 1).padStart(2, '0')}`;
        const bucket = ensureMtd((all && all[mk]) || {});
        const offKeys = advisorOffDates(pacingAdv, y, mo, schedules, vacations);
        const p = dailyPacing({ hoursGoal: bucket.hoursGoal, mtd: pacingMtd, year: y, month: mo, offKeys, today: now });
        if (!cancelled) setPacing(p);
      } catch { if (!cancelled) setPacing(null); }
    })();
    return () => { cancelled = true; };
  }, [pacingAdv, pacingMtd, schedules, vacations]);

  // Missed End-of-Day Reporting pin: count the logged-in advisor's own
  // unreported prior working days this month. Drives an attention badge on the
  // End of Day Reporting button; recomputes on mount and whenever refreshKey
  // bumps (i.e. after they come back from reporting), so it clears once fixed.
  const [missedEodCount, setMissedEodCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const me = (currentUser || '').toUpperCase();
    // Only advisors with a forecast are on the hook; managers just viewing others aren't pinned.
    if (!me || !(advisorList || []).map(a => (a || '').toUpperCase()).includes(me)) {
      setMissedEodCount(0);
      return;
    }
    loadAdvisorGoals(me).then(all => {
      if (cancelled) return;
      const now = new Date();
      const days = ((all && all[monthKeyCal(now)]) || {}).days || {};
      const off = advisorOffDates(me, now.getFullYear(), now.getMonth(), schedules, vacations);
      const report = new Date(); while (report.getDay() === 0) report.setDate(report.getDate() - 1);
      const reportKey = dKeyCal(report);
      const missed = workingDatesCal(now.getFullYear(), now.getMonth()).filter(d => {
        const k = dKeyCal(d);
        return k < reportKey && !off.has(k) && !Object.prototype.hasOwnProperty.call(days, k);
      }).length;
      setMissedEodCount(missed);
    }).catch(() => { if (!cancelled) setMissedEodCount(0); });
    return () => { cancelled = true; };
  }, [currentUser, advisorList, schedules, vacations, refreshKey]);
  const eodMissed = missedEodCount > 0;

  // After Call Reviews attention badge. Same end-of-day trigger as End of Day
  // Reporting: from 3pm Eastern the button pulses with a count of the surveys
  // the logged-in advisor still owes a call on. The survey file is ~400KB, so it
  // is only fetched once that window opens — before 3pm this costs nothing.
  // Never nags at zero: no pending calls, no pulse.
  const [pendingCallCount, setPendingCallCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const me = (currentUser || '').toUpperCase();
    // Anyone who owes calls gets pinned — NOT just names in advisorList.
    // Managers are added to the calendar as a separate hard-coded tab and never
    // appear in advisorList, so gating on it meant a manager with pending
    // surveys could never light up while End of Day Reporting, which keys off
    // the clock alone, lit for them every afternoon. Whether there is anything
    // to call is decided by the count below, which is self-limiting: someone
    // with no surveys to their name simply counts zero.
    if (!eodUrgent || !me) { setPendingCallCount(0); return; }
    Promise.all([loadServiceInvitations(), loadCompletedReviews(me)])
      .then(([si, completed]) => {
        if (cancelled) return;
        setPendingCallCount(pendingSurveysFor(si, completed, me).length);
      })
      .catch(() => { if (!cancelled) setPendingCallCount(0); });
    return () => { cancelled = true; };
  }, [eodUrgent, currentUser, refreshKey]);
  const afterCallDue = pendingCallCount > 0;
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [noteDates, setNoteDates] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [scheduleEvents, setScheduleEvents] = useState({}); // { 'YYYY-MM-DD': [{name, type}] }
  const [advisorWip, setAdvisorWip] = useState(() => readWipCache()?.wip || []);
  const [advisorAwaiting, setAdvisorAwaiting] = useState(() => readWipCache()?.awaiting || []);
  const [wipLoading, setWipLoading] = useState(false);
  const [roSearch, setRoSearch] = useState('');
  const [showPartsReceived, setShowPartsReceived] = useState(false);
  const [techChatRefresh, setTechChatRefresh] = useState(0);

  // Open the WIP page for the first job whose RO# matches the query. Called by
  // both the Enter key in the search box and the "Open" button.
  function openRoSearch(rawValue) {
    const raw = String(rawValue ?? '').trim();
    if (!raw) return;
    const q = raw.toLowerCase();
    const wipMatches = (advisorWip || []).filter(j => (j.ro || '').toLowerCase().includes(q));
    const awMatches  = (advisorAwaiting || []).filter(j => (j.ro || '').toLowerCase().includes(q));
    if (wipMatches.length === 0 && awMatches.length === 0) {
      if (onWorkInProgress) onWorkInProgress(raw);
      return;
    }
    const all = [
      ...wipMatches.map(j => ({ j, source: 'wip' })),
      ...awMatches.map(j => ({ j, source: 'awaiting' })),
    ];
    const exact = all.find(({ j }) => (j.ro || '').toLowerCase() === q);
    const hit = exact || all[0];
    if (onWorkInProgress) onWorkInProgress({ ro: hit.j.ro || raw, tech: hit.j.tech || '', source: hit.source });
  }
  const [deletingId, setDeletingId] = useState(null);
  const [flaggingId, setFlaggingId] = useState(null);

  // Only managers/admins raise the attention flag. Advisors (and other
  // non-managers) clear it automatically when they open the row.
  const canManageWip = currentRole === 'admin' || (currentRole || '').includes('manager');
  // Lead advisors can also bulk-upload ROs (not full WIP flag management).
  const canRoUpload = canManageWip || currentRole === 'lead advisor';

  // Green-flagged ROs are used cars — they live in their own "Used Cars" tab,
  // out of the normal WIP / awaiting lists. Anyone on this page can view it.
  const [showUsedCars, setShowUsedCars] = useState(false);
  const isUsedCar = (j) => !!j && (j.usedCar === true || j.flag === 'green' || /used car inspection/i.test(j.jobDesc || ''));
  const usedCarJobs = [...(advisorWip || []).map(j => ({ ...j, _src: 'wip' })), ...(advisorAwaiting || []).map(j => ({ ...j, _src: 'awaiting' }))].filter(isUsedCar);

  // Raise/lower the attention flag on a WIP row (persists to the tech's file).
  async function setWipFlag(job, flagged) {
    if (!job || !job.tech || !job.id) return;
    setFlaggingId(job.id);
    // Optimistic UI so the flag appears/disappears instantly.
    setAdvisorWip(prev => prev.map(r => r.id === job.id ? { ...r, flagged } : r));
    try {
      const existing = await loadWipData(job.tech);
      const updated = (existing || []).map(r => r.id === job.id ? { ...r, flagged } : r);
      await saveWipData(job.tech, updated);
    } catch (e) {
      console.warn('WIP flag update failed:', e);
    } finally {
      setFlaggingId(null);
    }
  }

  // Raise/lower the attention flag on a Cars-Awaiting row (persists to AWAITING).
  async function setAwaitingFlag(job, flagged) {
    if (!job || !job.id) return;
    setFlaggingId(job.id);
    setAdvisorAwaiting(prev => prev.map(r => r.id === job.id ? { ...r, flagged } : r));
    try {
      const existing = await loadAwaitingData();
      const updated = (existing || []).map(r => r.id === job.id ? { ...r, flagged } : r);
      await saveAwaitingData(updated);
    } catch (e) {
      console.warn('Awaiting flag update failed:', e);
    } finally {
      setFlaggingId(null);
    }
  }

  async function deleteWipJob(job) {
    if (!job || !job.tech || !job.id) return;
    setDeletingId(job.id);
    try {
      const existing = await loadWipData(job.tech);
      const victim = (existing || []).find(r => r.id === job.id) || job;
      const updated = (existing || []).filter(r => r.id !== job.id);
      await saveWipData(job.tech, updated);
      setAdvisorWip(prev => prev.filter(r => r.id !== job.id));
      try {
        await appendRoArchive({
          ...victim,
          _archiveId: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          _archivedAt: new Date().toISOString(),
          _archivedBy: (currentUser || '').toUpperCase(),
          _source: 'wip',
          _sourceTech: job.tech,
        });
      } catch (archErr) { console.warn('RO archive append failed:', archErr); }
    } catch (e) {
      alert('Failed to delete: ' + (e.message || e));
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteAwaitingJob(job) {
    if (!job || !job.id) return;
    setDeletingId(job.id);
    try {
      const existing = await loadAwaitingData();
      const victim = (existing || []).find(r => r.id === job.id) || job;
      const updated = (existing || []).filter(r => r.id !== job.id);
      await saveAwaitingData(updated);
      setAdvisorAwaiting(prev => prev.filter(r => r.id !== job.id));
      try {
        await appendRoArchive({
          ...victim,
          _archiveId: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          _archivedAt: new Date().toISOString(),
          _archivedBy: (currentUser || '').toUpperCase(),
          _source: 'awaiting',
          _sourceTech: '',
        });
      } catch (archErr) { console.warn('RO archive append failed:', archErr); }
    } catch (e) {
      alert('Failed to delete: ' + (e.message || e));
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    if (!viewingAdvisor) return;
    let cancelled = false;

    // `silent` skips the loading spinner so background polls don't flicker
    // the panels while a user is reading them.
    const fetchJobs = (silent) => {
      if (!silent) setWipLoading(true);
      // Tech names come from App (already in memory) so we skip a whole
      // loadDashboardData() round-trip on the critical path. Fall back to the
      // fetch only if the list wasn't provided.
      const techsPromise = (techNames && techNames.length)
        ? Promise.resolve(techNames)
        : loadDashboardData().then(d => (d?.data?.technicians || []).map(t => t.name).filter(Boolean)).catch(() => []);
      return Promise.all([
        techsPromise.then(techs =>
          Promise.all(techs.map(t =>
            loadWipData(t).then(rows => (rows || []).map(r => ({ ...r, tech: t })))
          )).then(all => all.flat())
        ).catch(() => []),
        loadAwaitingData().then(rows => rows || []).catch(() => []),
      ]).then(([wip, awaiting]) => {
        if (cancelled) return;
        // Defensive dedupe by row id only. We INTENTIONALLY don't dedupe by
        // RO# here, because two techs legitimately working on related ROs
        // should both show up. Only true duplicate rows (same id appearing
        // in multiple tech files due to a sync bug) get collapsed.
        const seenIds = new Set();
        const cleanWip = [];
        for (const r of wip) {
          if (r.id && seenIds.has(r.id)) continue;
          if (r.id) seenIds.add(r.id);
          cleanWip.push(r);
        }
        setAdvisorWip(cleanWip);
        setAdvisorAwaiting(awaiting);
        writeWipCache(cleanWip, awaiting);
      }).finally(() => { if (!cancelled && !silent) setWipLoading(false); });
    };

    // If we already have cached jobs on screen, refresh silently (no spinner)
    // so the manager isn't shown "Loading…" over data that's already there.
    fetchJobs(readWipCache() != null);
    // Live updates: poll every 20s so edits by other users appear without a
    // manual page refresh.
    const poll = setInterval(() => fetchJobs(true), 20000);
    // Also refresh immediately when the user returns to this tab.
    const onVisible = () => { if (document.visibilityState === 'visible') fetchJobs(true); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [viewingAdvisor, refreshKey, (techNames || []).join(',')]);

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
    <div className="adv-page apt-prep-bg" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showPartsReceived && (
        <PartsReceived currentUser={currentUser || ''} onPosted={() => setTechChatRefresh(n => n + 1)} onClose={() => setShowPartsReceived(false)} />
      )}
      <div className="adv-topbar">
        <div>
          <div className="adv-title">Appointment Prep Calendar</div>
          <div className="adv-sub">
            {isViewingOwn ? `${viewingAdvisor} (My Calendar)` : `Viewing: ${viewingAdvisor}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canSee(userPages, currentRole, 'hotRepairs') && onHotRepairs && (
            <button onClick={onHotRepairs} style={{ background: 'linear-gradient(180deg,rgba(248,113,113,.25),rgba(239,68,68,.18))', borderColor: 'rgba(248,113,113,.35)' }}>
              🔧 Recalls/TSB Bulletins
            </button>
          )}
          {canSee(userPages, currentRole, 'documentLibrary') && (
            <button onClick={onDocumentLibrary} style={{ background: 'linear-gradient(180deg,rgba(110,231,249,.25),rgba(61,214,195,.18))', borderColor: 'rgba(110,231,249,.35)' }}>
              📁 Document Library
            </button>
          )}
          {canSee(userPages, currentRole, 'chargeAccountList') && onChargeList && (
            <button onClick={onChargeList} style={{ background: 'linear-gradient(180deg,rgba(251,113,133,.25),rgba(244,63,94,.18))', borderColor: 'rgba(251,113,133,.35)' }}>
              💳 Charge List
            </button>
          )}
          {canSee(userPages, currentRole, 'servicePricing') && onServicePricing && (
            <button onClick={onServicePricing} style={{ background: 'linear-gradient(180deg,rgba(52,211,153,.25),rgba(16,185,129,.18))', borderColor: 'rgba(52,211,153,.35)' }}>
              💲 Service Pricing Menu
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
          {onAfterCall && (
            <>
              {afterCallDue && <style>{`@keyframes acPulse{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.55);transform:scale(1)}50%{box-shadow:0 0 20px 7px rgba(52,211,153,.75);transform:scale(1.06)}}@keyframes acBellBob{0%,100%{transform:translateY(0) rotate(-8deg)}50%{transform:translateY(-3px) rotate(-8deg)}}`}</style>}
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <button onClick={onAfterCall}
                  style={afterCallDue
                    ? { background: 'linear-gradient(180deg,#10b981,#047857)', borderColor: '#a7f3d0', color: '#fff', fontWeight: 900, animation: 'acPulse 1.2s ease-in-out infinite' }
                    : { background: 'linear-gradient(180deg,rgba(52,211,153,.25),rgba(16,185,129,.18))', borderColor: 'rgba(52,211,153,.35)' }}>
                  {afterCallDue ? '📞 After Call Reviews ‼️' : '📞 After Call Reviews'}
                </button>
                {afterCallDue && (
                  <span
                    title={`You have ${pendingCallCount} customer${pendingCallCount === 1 ? '' : 's'} still to call for their after-call review`}
                    style={{
                      position: 'absolute', top: -9, right: -9, minWidth: 22, height: 22, padding: '0 6px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999,
                      background: '#a7f3d0', color: '#064e3b', fontWeight: 900, fontSize: 12,
                      border: '2px solid #0b1220', boxShadow: '0 2px 8px rgba(0,0,0,.5)',
                      transformOrigin: 'center', animation: 'acBellBob 1.1s ease-in-out infinite', pointerEvents: 'none',
                    }}>
                    {pendingCallCount}
                  </span>
                )}
              </span>
            </>
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
          {onCashDash && (
            <>
              <style>{`@keyframes cashGlow{0%,100%{box-shadow:0 0 10px 0 rgba(34,197,94,.55)}50%{box-shadow:0 0 20px 5px rgba(34,197,94,.85)}}`}</style>
              <button onClick={onCashDash}
                style={{ background: 'linear-gradient(180deg,#22c55e,#059669)', borderColor: '#6ee7b7', color: '#052e16', fontWeight: 900, textShadow: '0 1px 0 rgba(255,255,255,.25)', animation: 'cashGlow 1.8s ease-in-out infinite' }}>
                💰 Cash Dash
              </button>
            </>
          )}
          {onGoalsForecasting && (
            <>
              {(eodUrgent || eodMissed) && <style>{`@keyframes eodPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.55);transform:scale(1)}50%{box-shadow:0 0 20px 7px rgba(239,68,68,.7);transform:scale(1.06)}}@keyframes eodPinBob{0%,100%{transform:translateY(0) rotate(-8deg)}50%{transform:translateY(-3px) rotate(-8deg)}}`}</style>}
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <button onClick={onGoalsForecasting}
                  style={eodMissed
                    ? { background: 'linear-gradient(180deg,#dc2626,#991b1b)', borderColor: '#fecaca', color: '#fff', fontWeight: 900, animation: 'eodPulse 1.1s ease-in-out infinite' }
                    : eodUrgent
                    ? { background: 'linear-gradient(180deg,#f97316,#ef4444)', borderColor: '#fecaca', color: '#fff', fontWeight: 900, animation: 'eodPulse 1.3s ease-in-out infinite' }
                    : { background: 'linear-gradient(180deg,rgba(167,139,250,.25),rgba(139,92,246,.18))', borderColor: 'rgba(167,139,250,.35)' }}>
                  {eodMissed
                    ? `📌 Missed Reporting — Fix Now`
                    : eodUrgent ? '⏰ End of Day Reporting ‼️' : '🎯 End of Day Reporting'}
                </button>
                {eodMissed && (
                  <span
                    title={`You have ${missedEodCount} missed day${missedEodCount === 1 ? '' : 's'} of End of Day Reporting to complete`}
                    style={{
                      position: 'absolute', top: -9, right: -9, minWidth: 22, height: 22, padding: '0 6px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999,
                      background: '#fbbf24', color: '#7c2d12', fontWeight: 900, fontSize: 12,
                      border: '2px solid #0b1220', boxShadow: '0 2px 8px rgba(0,0,0,.5)',
                      transformOrigin: 'center', animation: 'eodPinBob 1.1s ease-in-out infinite', pointerEvents: 'none',
                    }}>
                    {missedEodCount}
                  </span>
                )}
              </span>
            </>
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
            refreshKey={techChatRefresh}
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
              {DAY_NAMES.map((d, i) => (
                <div key={d} className={`adv-cal-dayname${i === 0 ? ' adv-cal-dayname--off' : ''}`}>{d}</div>
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
                // Cell colour, weakest signal to strongest: closed Sunday, then
                // whatever event the day carries, then today on top.
                const isPast   = dateStr < todayStr;
                const isSunday = i % 7 === 0;
                const eventTint = events.some(e => e.type === 'holiday')  ? ' adv-cal-day--holiday'
                                : events.some(e => e.type === 'vacation') ? ' adv-cal-day--vacation'
                                : events.some(e => e.type === 'training') ? ' adv-cal-day--training'
                                : '';
                const cls = 'adv-cal-day'
                  + (isSunday && !eventTint ? ' adv-cal-day--closed' : '')
                  + eventTint
                  + (isPast && !isToday ? ' adv-cal-day--past' : '')
                  + (hasNotes ? ' adv-has-notes' : '')
                  + (isToday ? ' adv-today' : '');
                return (
                  <div
                    key={dateStr}
                    className={cls}
                    onClick={() => onSelectDay(dateStr)}
                  >
                    <span className="adv-day-num">{d}</span>
                    {isToday && <span className="adv-today-chip">TODAY</span>}
                    {hasNotes && <span className="adv-note-dot" title="Prep notes saved" />}
                    {isToday && pacing && (
                      <div title={pacing.mode === 'behind'
                          ? 'Hours to sell today to reach your monthly goal'
                          : 'Hours to sell today to hold your pace above goal'}
                        style={{
                          marginTop: 6, borderRadius: 8, padding: '4px 7px', lineHeight: 1.15,
                          background: pacing.mode === 'behind' ? 'rgba(251,146,60,.16)' : 'rgba(74,222,128,.16)',
                          border: `1px solid ${pacing.mode === 'behind' ? 'rgba(251,146,60,.5)' : 'rgba(74,222,128,.5)'}`,
                        }}>
                        <div style={{ fontSize: 12.5, fontWeight: 900, color: pacing.mode === 'behind' ? '#fdba74' : '#86efac' }}>
                          🎯 {pacing.value.toFixed(1)} hrs
                        </div>
                        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: .3, textTransform: 'uppercase', color: '#94a3b8' }}>
                          {pacing.mode === 'behind' ? 'to hit goal' : 'to hold pace'}
                        </div>
                      </div>
                    )}
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

            <div className="adv-cal-legend">
              <span><i style={{ background: 'linear-gradient(180deg,#22d3ee,#3b82f6)', borderColor: 'rgba(110,231,249,.7)' }} />Today</span>
              <span><i style={{ background: 'var(--teal)', borderColor: 'transparent', width: 4, height: 13, borderRadius: 2 }} />Prep notes saved</span>
              <span><i style={{ background: 'rgba(74,222,128,.45)', borderColor: 'rgba(74,222,128,.6)' }} />Vacation</span>
              <span><i style={{ background: 'rgba(96,165,250,.45)', borderColor: 'rgba(96,165,250,.6)' }} />Training</span>
              <span><i style={{ background: 'rgba(244,114,182,.45)', borderColor: 'rgba(244,114,182,.6)' }} />Holiday</span>
            </div>

            {loading && <div className="adv-loading">Loading saved notes...</div>}
          </div>

          {/* RO search */}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={roSearch}
              onChange={e => setRoSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                // Read straight from the DOM so browser-autofilled values that
                // haven't yet flushed through onChange still navigate correctly.
                openRoSearch(e.currentTarget.value);
              }}
              placeholder="🔍 Search RO # across all WIP and awaiting… (Enter or click Open)"
              style={{
                flex: 1, background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none',
              }}
            />
            <button
              onClick={() => openRoSearch(roSearch)}
              disabled={!roSearch.trim()}
              style={{
                background: roSearch.trim() ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${roSearch.trim() ? 'rgba(96,165,250,.5)' : 'rgba(255,255,255,.1)'}`,
                color: roSearch.trim() ? '#93c5fd' : '#475569',
                borderRadius: 10, padding: '8px 16px', fontWeight: 800, fontSize: 13,
                cursor: roSearch.trim() ? 'pointer' : 'default',
              }}
            >
              Open
            </button>
            <button
              onClick={() => setShowUsedCars(v => !v)}
              title="Green-flagged repair orders (used cars)"
              style={{
                background: showUsedCars ? 'rgba(52,211,153,.35)' : 'rgba(52,211,153,.14)',
                border: `1px solid ${showUsedCars ? 'rgba(52,211,153,.75)' : 'rgba(52,211,153,.4)'}`,
                color: '#6ee7b7', borderRadius: 10, padding: '8px 16px', fontWeight: 800, fontSize: 13,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >🚗 Used Cars{usedCarJobs.length ? ` (${usedCarJobs.length})` : ''}</button>
            {canUsePartsReceived(currentRole) && (
              <button
                onClick={() => setShowPartsReceived(true)}
                title="Mark parts received for a repair order"
                style={{
                  background: 'rgba(110,231,183,.18)', border: '1px solid rgba(110,231,183,.45)',
                  color: '#6ee7b7', borderRadius: 10, padding: '8px 16px', fontWeight: 800, fontSize: 13,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >📦 Parts Received</button>
            )}
            {canRoUpload && onRoUpload && (
              <button
                onClick={onRoUpload}
                title="Bulk-add repair orders from an .xlsx open RO report (managers only)"
                style={{
                  background: 'rgba(52,211,153,.18)', border: '1px solid rgba(52,211,153,.5)',
                  color: '#6ee7b7', borderRadius: 10, padding: '8px 16px', fontWeight: 800, fontSize: 13,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >📤 RO Upload</button>
            )}
            {canManageWip && onRepairOrderProcess && (
              <button
                onClick={onRepairOrderProcess}
                title="Repair Order Process — RO status report (managers only)"
                style={{
                  background: 'rgba(96,165,250,.16)', border: '1px solid rgba(96,165,250,.5)',
                  color: '#93c5fd', borderRadius: 10, padding: '8px 16px', fontWeight: 800, fontSize: 13,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >🧰 Repair Order Process</button>
            )}
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
          {showUsedCars ? (
            <AdvisorJobsPanel
              title="🚗 Used Cars (Green-Flagged)"
              emptyText="No used-car ROs right now. Green-flagged ROs from the RO upload show here."
              jobs={roSearch.trim() ? usedCarJobs.filter(j => (j.ro || '').toLowerCase().includes(roSearch.trim().toLowerCase())) : usedCarJobs}
              showAdvisor
              showTech
              loading={wipLoading}
              color="#34d399"
              bg="rgba(52,211,153,.07)"
              border="rgba(52,211,153,.3)"
              highlightAdvisor={(ownAdvisor || '').toUpperCase() === 'SHAWN' ? '' : ownAdvisor}
              onOpen={onWorkInProgress ? (j) => { if (j.flagged && !canManageWip) (j._src === 'wip' ? setWipFlag : setAwaitingFlag)(j, false); onWorkInProgress({ ro: j.ro || '', tech: j._src === 'wip' ? (j.tech || '') : '', source: j._src }); } : undefined}
              canFlag={canManageWip}
              onFlag={(j) => (j._src === 'wip' ? setWipFlag : setAwaitingFlag)(j, !j.flagged)}
              flaggingId={flaggingId}
              onDelete={(j) => (j._src === 'wip' ? deleteWipJob : deleteAwaitingJob)(j)}
              deletingId={deletingId}
            />
          ) : (<>
          <AdvisorJobsPanel
            title="All WIP (Manager View)"
            emptyText="No active WIPs in the shop."
            jobs={(roSearch.trim() ? advisorWip.filter(j => (j.ro || '').toLowerCase().includes(roSearch.trim().toLowerCase())) : advisorWip).filter(j => !isUsedCar(j))}
            showAdvisor
            showTech
            loading={wipLoading}
            color="#3dd6c3"
            bg="rgba(61,214,195,.06)"
            border="rgba(61,214,195,.25)"
            highlightAdvisor={(ownAdvisor || '').toUpperCase() === 'SHAWN' ? '' : ownAdvisor}
            onOpen={onWorkInProgress ? (j) => { if (j.flagged && !canManageWip) setWipFlag(j, false); onWorkInProgress({ ro: j.ro || '', tech: j.tech || '', source: 'wip' }); } : undefined}
            canFlag={canManageWip}
            onFlag={(j) => setWipFlag(j, !j.flagged)}
            flaggingId={flaggingId}
            onDelete={deleteWipJob}
            deletingId={deletingId}
          />
          <AdvisorJobsPanel
            title="All Cars Waiting on Tech"
            emptyText="No cars currently waiting on a tech."
            highlightAdvisor={(ownAdvisor || '').toUpperCase() === 'SHAWN' ? '' : ownAdvisor}
            jobs={(roSearch.trim() ? advisorAwaiting.filter(j => (j.ro || '').toLowerCase().includes(roSearch.trim().toLowerCase())) : advisorAwaiting).filter(j => !isUsedCar(j))}
            showAdvisor
            loading={wipLoading}
            color="#fbbf24"
            bg="rgba(251,191,36,.06)"
            border="rgba(251,191,36,.25)"
            onOpen={onWorkInProgress ? (j) => { if (j.flagged && !canManageWip) setAwaitingFlag(j, false); onWorkInProgress({ ro: j.ro || '', tech: '', source: 'awaiting' }); } : undefined}
            canFlag={canManageWip}
            onFlag={(j) => setAwaitingFlag(j, !j.flagged)}
            flaggingId={flaggingId}
            onDelete={deleteAwaitingJob}
            deletingId={deletingId}
          />
          </>)}
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
