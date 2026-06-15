import React, { useEffect, useMemo, useState } from 'react';
import { loadUserActivity, listActivityUsernames, loadUsers } from '../utils/github';

// Friendly labels for the page keys App.jsx uses with trackPage(...).
const PAGE_LABELS = {
  'dashboard': 'Dashboard',
  'tv-mode': 'TV Mode',
  'tech-resources': 'Tech Resources',
  'work-in-progress': 'Work In Progress',
  'aftermarket-warranty': 'Aftermarket Warranty',
  'tire-warranty': 'Tire Warranty',
  'document-library': 'Document Library',
  'work-schedule': 'Work Schedule',
  'tech-schedule': 'Tech Schedule',
  'advisor-view-tech-schedule': 'Tech Schedule',
  'advisor-calendar': 'Advisor Calendar',
  'advisor-day': 'Advisor Day Form',
  'survey-reports': 'Survey Reports',
  'manager-hub': 'Manager Hub',
  'mgr-performance-reports': 'Manager: Performance Reports',
  'performance-report': 'My Performance Report',
  'repair-order-database': 'Repair Order Database',
  'user-data-tracker': 'User Data Tracker',
  'goal-forecast': 'Goal Forecast',
  'charge-account-list': 'Charge Account List',
  'employee-review': 'Employee Review',
  'tech-self-review': 'Tech Self-Review',
  'original-owner': 'Original Owner Affidavit',
  'parts-hub': 'Parts Hub',
  'at-diag-worksheet': 'AT Diag Worksheet',
};
function labelForPage(key) {
  if (PAGE_LABELS[key]) return PAGE_LABELS[key];
  return (key || '').split('-').map(s => s ? s[0].toUpperCase() + s.slice(1) : '').join(' ');
}

const ACTION_LABELS = {
  'login': '🔑 Logged In',
  'logout': '🚪 Logged Out',
  'save-dashboard': '💾 Saved Dashboard',
  'send-to-reports': '📤 Sent to Reports',
  'upload-advisor-xlsx': '📥 Uploaded Advisor XLSX',
  'upload-advisor-pdf': '📥 Uploaded Advisor PDF',
  'delete-wip-row': '🗑 Deleted WIP Row',
  'delete-awaiting-row': '🗑 Deleted Awaiting Row',
  'mark-parts-arrived': '📦 Marked Parts Arrived',
  'mark-parts-pending': '⏳ Marked Parts Pending',
  'undo-parts-arrived': '↩ Undid Parts Arrived',
  'generate-advisor-ai-report': '🤖 Generated Advisor AI Report',
  'generate-tech-ai-report': '🤖 Generated Tech AI Report',
  'view-ai-reports': '📂 Opened AI Reports Viewer',
};
function labelForAction(key) {
  if (ACTION_LABELS[key]) return ACTION_LABELS[key];
  return (key || '').split('-').map(s => s ? s[0].toUpperCase() + s.slice(1) : '').join(' ');
}

function dayKey(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function fmtDayLabel(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

export default function UserDataTracker({ onBack }) {
  const [users, setUsers] = useState([]);            // [{ username, role, lastActiveAt, totalEvents }]
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  // Build the sidebar from BOTH the registered user list (so admins are
  // hidden) AND the actual activity directory (so anyone with prior activity
  // still shows up even if their account got deactivated).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingUsers(true);
      try {
        const [usersResult, activityList] = await Promise.all([
          loadUsers().catch(() => null),
          listActivityUsernames().catch(() => []),
        ]);
        if (cancelled) return;
        // loadUsers() returns { users, sharedSaveCode, ... } (or, for the legacy
        // array format, a bare array). Normalize to a plain users array so the
        // loops below don't choke on a non-iterable object.
        const allUsers = Array.isArray(usersResult)
          ? usersResult
          : (usersResult && Array.isArray(usersResult.users) ? usersResult.users : []);
        // Hide admins (per the tracking policy — admins are never tracked).
        const usernameToRole = {};
        for (const u of (allUsers || [])) {
          if (u && u.username) usernameToRole[u.username.toUpperCase()] = (u.role || '').toLowerCase();
        }
        const candidateSet = new Set();
        for (const u of (allUsers || [])) {
          if (!u || !u.username) continue;
          if ((u.role || '').toLowerCase() === 'admin') continue;
          candidateSet.add(u.username.toUpperCase());
        }
        for (const u of activityList) {
          if (usernameToRole[u] === 'admin') continue;
          candidateSet.add(u);
        }
        const candidates = Array.from(candidateSet).sort();

        // Fetch each user's recent activity so we can show last-active and total counts.
        const rows = await Promise.all(candidates.map(async u => {
          const log = await loadUserActivity(u).catch(() => []);
          const totalEvents = Array.isArray(log) ? log.length : 0;
          const lastActiveAt = log[0]?.at || null; // log is stored newest-first
          return { username: u, role: usernameToRole[u] || '', lastActiveAt, totalEvents };
        }));
        if (cancelled) return;
        rows.sort((a, b) => {
          const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
          const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
          return tb - ta;
        });
        setUsers(rows);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load the selected user's events.
  useEffect(() => {
    if (!selected) { setEvents([]); setSelectedDay(null); return; }
    let cancelled = false;
    setLoadingEvents(true);
    loadUserActivity(selected.username)
      .then(d => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : [];
        setEvents(list);
        // Default the day picker to whichever day had the most recent event.
        const newest = list[0]?.at ? dayKey(list[0].at) : null;
        setSelectedDay(newest);
      })
      .finally(() => { if (!cancelled) setLoadingEvents(false); });
    return () => { cancelled = true; };
  }, [selected]);

  // Group events by day for the day picker + day breakdown.
  const eventsByDay = useMemo(() => {
    const map = {};
    for (const e of events) {
      const k = dayKey(e.at);
      if (!k) continue;
      (map[k] = map[k] || []).push(e);
    }
    return map;
  }, [events]);
  const days = useMemo(() => Object.keys(eventsByDay).sort((a, b) => b.localeCompare(a)), [eventsByDay]);

  const dayEvents = selectedDay ? (eventsByDay[selectedDay] || []) : [];
  const daySorted = useMemo(() => [...dayEvents].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()), [dayEvents]);
  const firstSeen = daySorted[0]?.at || null;
  const lastSeen  = daySorted[daySorted.length - 1]?.at || null;
  const pageCount   = daySorted.filter(e => e.type === 'page').length;
  const actionCount = daySorted.filter(e => e.type === 'action').length;

  function fmtRelative(iso) {
    if (!iso) return 'no activity yet';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
    return new Date(iso).toLocaleDateString();
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">📡 User Data Tracker</div>
          <div className="adv-sub">Last 30 days of page views and key actions per user. Admins are not tracked.</div>
        </div>
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left sidebar: user list */}
        <div style={{ width: 280, borderRight: '1px solid rgba(255,255,255,.06)', overflowY: 'auto', flexShrink: 0 }}>
          {loadingUsers ? (
            <div style={{ color: '#64748b', padding: 30, textAlign: 'center' }}>⏳ Loading users…</div>
          ) : users.length === 0 ? (
            <div style={{ color: '#64748b', padding: 30, textAlign: 'center' }}>No tracked users yet.</div>
          ) : (
            users.map(u => {
              const isSel = selected?.username === u.username;
              return (
                <button
                  key={u.username}
                  onClick={() => setSelected(u)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: isSel ? 'rgba(96,165,250,.14)' : 'transparent',
                    border: 'none', borderLeft: `3px solid ${isSel ? '#60a5fa' : 'transparent'}`,
                    color: isSel ? '#bfdbfe' : '#cbd5e1',
                    padding: '10px 14px', fontWeight: 800, fontSize: 13,
                    cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,.03)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{u.username}</span>
                    <span style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5 }}>{u.role || 'user'}</span>
                  </div>
                  <div style={{ fontSize: 11, color: u.lastActiveAt ? '#94a3b8' : '#475569', fontWeight: 600, marginTop: 2 }}>
                    {u.totalEvents} event{u.totalEvents === 1 ? '' : 's'} · {fmtRelative(u.lastActiveAt)}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Right pane: user detail */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
          {!selected ? (
            <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 80 }}>
              Pick a user on the left to see their daily activity timeline.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={{ fontWeight: 900, fontSize: 22, color: '#e2e8f0' }}>{selected.username}</div>
                <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>{selected.role || 'user'}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>
                  {events.length} event{events.length === 1 ? '' : 's'} on file
                </div>
              </div>

              {loadingEvents ? (
                <div style={{ color: '#64748b', textAlign: 'center', padding: 60 }}>⏳ Loading activity…</div>
              ) : events.length === 0 ? (
                <div style={{ color: '#64748b', textAlign: 'center', padding: 60 }}>
                  No activity recorded yet. {selected.role === 'admin' ? '(Admins are intentionally not tracked.)' : 'New events will appear here as the user navigates the site.'}
                </div>
              ) : (
                <>
                  {/* Day picker */}
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 6 }}>Day</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                    {days.map(d => {
                      const isSel = selectedDay === d;
                      const count = eventsByDay[d].length;
                      return (
                        <button
                          key={d}
                          onClick={() => setSelectedDay(d)}
                          style={{
                            background: isSel ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.04)',
                            border: `1px solid ${isSel ? 'rgba(96,165,250,.5)' : 'rgba(255,255,255,.1)'}`,
                            color: isSel ? '#bfdbfe' : '#94a3b8',
                            borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                          }}
                        >
                          {fmtDayLabel(d)} <span style={{ marginLeft: 6, fontSize: 10, opacity: .8 }}>{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Day summary */}
                  {selectedDay && (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                      <div style={{ background: 'rgba(96,165,250,.10)', border: '1px solid rgba(96,165,250,.3)', borderRadius: 10, padding: '8px 14px', minWidth: 120 }}>
                        <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 800, letterSpacing: .8, textTransform: 'uppercase' }}>Pages</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#bfdbfe' }}>{pageCount}</div>
                      </div>
                      <div style={{ background: 'rgba(45,212,191,.10)', border: '1px solid rgba(45,212,191,.3)', borderRadius: 10, padding: '8px 14px', minWidth: 120 }}>
                        <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 800, letterSpacing: .8, textTransform: 'uppercase' }}>Actions</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#a7f3d0' }}>{actionCount}</div>
                      </div>
                      <div style={{ background: 'rgba(168,85,247,.10)', border: '1px solid rgba(168,85,247,.3)', borderRadius: 10, padding: '8px 14px', minWidth: 140 }}>
                        <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 800, letterSpacing: .8, textTransform: 'uppercase' }}>First Seen</div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#e9d5ff' }}>{fmtTime(firstSeen) || '—'}</div>
                      </div>
                      <div style={{ background: 'rgba(168,85,247,.10)', border: '1px solid rgba(168,85,247,.3)', borderRadius: 10, padding: '8px 14px', minWidth: 140 }}>
                        <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 800, letterSpacing: .8, textTransform: 'uppercase' }}>Last Seen</div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#e9d5ff' }}>{fmtTime(lastSeen) || '—'}</div>
                      </div>
                    </div>
                  )}

                  {/* Timeline */}
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Timeline</div>
                  {daySorted.length === 0 ? (
                    <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No events for this day.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {daySorted.map((e, i) => {
                        const isPage = e.type === 'page';
                        const color = isPage ? '#60a5fa' : '#5eead4';
                        const bg    = isPage ? 'rgba(96,165,250,.07)' : 'rgba(45,212,191,.07)';
                        const border= isPage ? 'rgba(96,165,250,.2)'  : 'rgba(45,212,191,.2)';
                        return (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            background: bg, border: `1px solid ${border}`,
                            borderLeft: `3px solid ${color}`,
                            borderRadius: 8, padding: '7px 12px',
                          }}>
                            <div style={{ minWidth: 70, fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>{fmtTime(e.at)}</div>
                            <div style={{
                              fontSize: 9, fontWeight: 900, color, background: bg,
                              border: `1px solid ${border}`,
                              borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: .5,
                              minWidth: 50, textAlign: 'center',
                            }}>{isPage ? 'PAGE' : 'ACTION'}</div>
                            <div style={{ flex: 1, color: '#e2e8f0', fontSize: 13 }}>
                              {isPage ? labelForPage(e.label) : labelForAction(e.label)}
                            </div>
                            {e.details && (
                              <div style={{ fontSize: 11, color: '#64748b', maxWidth: 320, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.details}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
