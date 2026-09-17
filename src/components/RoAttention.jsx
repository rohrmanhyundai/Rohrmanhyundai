import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadRoStatusReport, loadRoAttention, updateRoAttention, sendGlobalMessage } from '../utils/github';
import { triggerEvent, GLOBAL_CHANNEL, GLOBAL_MSG_EVENT } from '../utils/pusher';
import { canonicalAdvisorFirst, firstNameUpper } from '../utils/advisorAliases';
import { evaluateRo, roAgeOf, prettyRoStatus } from './RepairOrderProcess';

/* Open Repair Order Attention — the right-hand column of the Appointment Prep
 * Calendar (where Advisor Chat used to sit; the chat bubble replaced it).
 *
 * Lists the viewed advisor's open ROs from the last RO Upload, oldest first,
 * with a note thread per RO so the advisor can say why it's still open and a
 * manager can ask. Managers/admin flag an RO to demand an update; the flag
 * clears itself the moment the advisor adds a note, and stays clear until a
 * manager flags it again. Flags and notes live in data/ro-attention.json keyed
 * by RO number, so they outlive every upload.
 */

// Same charcoal as the old chat panel so the column reads the same on the page.
const PANEL_BG = 'linear-gradient(180deg,#17181a 0%,#25272a 52%,#3a3d42 100%)';
const CLOSED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const nid = () => `rn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const mid = () => `gm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const when = (t) => {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const openStamp = (r) => {
  const d = new Date(r.openDate || '');
  if (!isNaN(d.getTime())) return d.getTime();
  const age = roAgeOf(r);
  return age == null ? Number.MAX_SAFE_INTEGER : Date.now() - age * 86400000;
};

export default function RoAttention({ currentUser, currentRole, viewingAdvisor, refreshKey = 0 }) {
  const me = (currentUser || '').toUpperCase();
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const advFirst = firstNameUpper(viewingAdvisor);
  const isOwn = firstNameUpper(currentUser) === advFirst;
  // Managers flag; the RO's own advisor and managers write notes; anyone else
  // viewing this calendar is read-only.
  const canFlag = isManager;
  const canNote = isManager || isOwn;

  const [report, setReport] = useState({ updatedAt: null, rows: [] });
  const [att, setAtt] = useState({ ros: {} });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');   // all | flagged
  const [openRo, setOpenRo] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');           // ro number being written
  const [showClosed, setShowClosed] = useState(false);
  const lastLoad = useRef(0);

  const load = useCallback(async (quiet) => {
    if (!quiet) setLoading(true);
    setErr('');
    try {
      const [rep, a] = await Promise.all([loadRoStatusReport(), loadRoAttention()]);
      setReport(rep || { updatedAt: null, rows: [] });
      setAtt(a && a.ros ? a : { ros: {} });
      lastLoad.current = Date.now();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load, refreshKey]);
  // Cheap freshness without a poll (the shared token is rate-limit sensitive):
  // re-read when the window regains focus, at most every 30s.
  useEffect(() => {
    const onFocus = () => { if (Date.now() - lastLoad.current > 30000) load(true); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);
  useEffect(() => { setOpenRo(''); setDraft(''); setFilter('all'); }, [viewingAdvisor]);

  // This advisor's open ROs, oldest first, each paired with its attention
  // record and the manager-rule severity.
  const rows = useMemo(() => {
    const list = (report.rows || [])
      .filter(r => canonicalAdvisorFirst(r.advisor) === advFirst)
      .map(r => {
        const ro = String(r.ro || '').trim();
        const a = att.ros[ro] || null;
        const sev = evaluateRo(r);
        return { ro, r, a, sev, age: roAgeOf(r), stamp: openStamp(r), flagged: !!(a && a.flagged), notes: (a && Array.isArray(a.notes)) ? a.notes : [] };
      })
      .sort((x, y) => x.stamp - y.stamp);
    return list;
  }, [report, att, advFirst]);
  const openSet = useMemo(() => new Set(rows.map(x => x.ro)), [rows]);
  // Threads for ROs that have since dropped off the open list — kept a while so
  // "why did that sit for two weeks" is still answerable.
  const closed = useMemo(() => Object.entries(att.ros || {})
    .filter(([ro, a]) => !openSet.has(ro) && firstNameUpper(a && a.advisor) === advFirst && ((a && a.notes && a.notes.length) || (a && a.flagged)))
    .map(([ro, a]) => ({ ro, a, notes: Array.isArray(a.notes) ? a.notes : [] }))
    .sort((x, y) => (y.a.lastSeenOpen || 0) - (x.a.lastSeenOpen || 0)), [att, openSet, advFirst]);

  const flaggedCount = rows.filter(x => x.flagged).length;
  const shown = filter === 'flagged' ? rows.filter(x => x.flagged) : rows;

  // Pop the person on the other side of the ask through the chat bubble.
  async function notify(to, text) {
    const target = String(to || '').toUpperCase();
    if (!target || target === me) return;
    const entry = { id: mid(), from: me, to: [target], text, alert: true, requireReply: false, replies: [], timestamp: Date.now() };
    try {
      await sendGlobalMessage(entry);
      try { await triggerEvent(GLOBAL_CHANNEL, GLOBAL_MSG_EVENT, entry); } catch {}
    } catch {}
  }

  // One write path for flag + note so the "advisor note clears the flag" rule
  // lives in exactly one place. Also stamps lastSeenOpen and prunes stale
  // closed threads, so the file can't grow forever.
  async function write(x, mutateRec, message) {
    setBusy(x.ro); setErr('');
    try {
      const next = await updateRoAttention(ros => {
        const rec = { advisor: advFirst, flagged: false, notes: [], ...(ros[x.ro] || {}) };
        rec.advisor = advFirst;
        rec.vehicle = x.r ? (x.r.vehicle || rec.vehicle || '') : (rec.vehicle || '');
        if (x.r) rec.lastSeenOpen = Date.now();
        mutateRec(rec);
        ros[x.ro] = rec;
        const cutoff = Date.now() - CLOSED_KEEP_MS;
        for (const [k, v] of Object.entries(ros)) {
          if (k !== x.ro && !openSet.has(k) && (v.lastSeenOpen || 0) < cutoff) delete ros[k];
        }
      }, message);
      setAtt(next && next.ros ? next : { ros: {} });
      return true;
    } catch (e) {
      setErr(e.message || String(e));
      return false;
    } finally {
      setBusy('');
    }
  }

  async function toggleFlag(x) {
    if (!canFlag || busy) return;
    const turningOn = !x.flagged;
    const ok = await write(x, rec => {
      rec.flagged = turningOn;
      if (turningOn) { rec.flaggedBy = me; rec.flaggedAt = Date.now(); }
      else { rec.clearedBy = me; rec.clearedAt = Date.now(); }
    }, `${turningOn ? 'Flag' : 'Unflag'} RO ${x.ro}`);
    if (ok && turningOn) notify(advFirst, `🚩 RO ${x.ro}${x.r && x.r.vehicle ? ` (${x.r.vehicle})` : ''} has been flagged — add a note on the calendar about why it's still open.`);
  }

  async function addNote(x) {
    const text = draft.trim();
    if (!text || !canNote || busy) return;
    const role = isManager ? 'manager' : 'advisor';
    const wasFlagged = x.flagged;
    const flaggedBy = x.a && x.a.flaggedBy;
    const ok = await write(x, rec => {
      rec.notes = [...(rec.notes || []), { id: nid(), by: me, role, text, at: Date.now() }];
      // The advisor answering is what the flag was for — it clears itself.
      if (role === 'advisor' && rec.flagged) { rec.flagged = false; rec.answeredBy = me; rec.answeredAt = Date.now(); }
    }, `RO ${x.ro} note by ${me}`);
    if (!ok) return;
    setDraft('');
    if (role === 'manager') notify(advFirst, `📝 ${me} on RO ${x.ro}: ${text}`);
    else if (wasFlagged && flaggedBy) notify(flaggedBy, `✅ ${me} updated flagged RO ${x.ro}: ${text}`);
  }

  const asOf = report.updatedAt ? when(report.updatedAt) : '';

  const chip = (on, color = '#7dd3fc') => ({
    background: on ? `${color}2b` : 'rgba(255,255,255,.05)', border: `1px solid ${on ? color + '80' : 'rgba(255,255,255,.12)'}`,
    color: on ? color : '#94a3b8', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  });

  const renderThread = (notes) => notes.length === 0 ? null : (
    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      {notes.map(n => {
        const mgr = n.role === 'manager';
        return (
          <div key={n.id} style={{ background: mgr ? 'rgba(251,191,36,.08)' : 'rgba(56,189,248,.08)', border: `1px solid ${mgr ? 'rgba(251,191,36,.3)' : 'rgba(56,189,248,.3)'}`, borderRadius: 9, padding: '6px 9px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: mgr ? '#fcd34d' : '#7dd3fc' }}>
              {mgr ? '👔 ' : ''}{(n.by || '').toUpperCase() === me ? 'You' : String(n.by || '').toUpperCase()}
              <span style={{ color: '#64748b', fontWeight: 600 }}> · {when(n.at)}</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.4, color: '#e2e8f0', whiteSpace: 'pre-wrap', marginTop: 2 }}>{n.text}</div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: PANEL_BG, border: '1px solid rgba(255,255,255,.08)', borderRadius: 18, overflow: 'hidden', height: '100%', color: '#e2e8f0', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#f97316,#ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>🔎</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 14, lineHeight: 1.15 }}>Open RO Attention</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2, lineHeight: 1.3 }}>
            {advFirst || '—'} · {rows.length} open{asOf ? <><br />as of {asOf}</> : null}
          </div>
        </div>
        <button onClick={() => load(false)} title="Refresh" disabled={loading}
          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 15, padding: 2, fontFamily: 'inherit' }}>↻</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', alignItems: 'center' }}>
        <button onClick={() => setFilter('all')} style={chip(filter === 'all')}>All · {rows.length}</button>
        <button onClick={() => setFilter('flagged')} style={chip(filter === 'flagged', '#f87171')}>🚩 Flagged · {flaggedCount}</button>
        <div style={{ flex: 1 }} />
        {!canNote && <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>view only</span>}
      </div>

      {err && <div style={{ margin: '8px 12px 0', padding: '7px 10px', borderRadius: 8, background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.4)', color: '#fca5a5', fontSize: 11.5, fontWeight: 700 }}>⚠️ {err}</div>}

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ color: '#64748b', fontSize: 12.5, padding: '10px 0', textAlign: 'center' }}>Loading…</div>
        ) : !report.rows || report.rows.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 12.5, padding: '10px 4px', lineHeight: 1.5 }}>No RO Upload yet. Upload the open-RO report and this list fills in automatically.</div>
        ) : shown.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 12.5, padding: '10px 4px', lineHeight: 1.5 }}>
            {filter === 'flagged' ? `Nothing flagged for ${advFirst}.` : `No open ROs for ${advFirst} in the last upload.`}
          </div>
        ) : shown.map(x => {
          const isOpen = openRo === x.ro;
          const needsAnswer = x.flagged && isOwn;
          const sevColor = x.sev.sev > 0 ? x.sev.color : '#64748b';
          const border = x.flagged ? 'rgba(248,113,113,.6)' : x.sev.sev >= 7 ? `${x.sev.color}80` : 'rgba(255,255,255,.1)';
          return (
            <div key={x.ro} style={{ background: x.flagged ? 'rgba(248,113,113,.08)' : 'rgba(255,255,255,.04)', border: `1px solid ${border}`, borderRadius: 12, padding: '9px 11px' }}>
              <div onClick={() => { setOpenRo(isOpen ? '' : x.ro); setDraft(''); }} style={{ cursor: 'pointer', userSelect: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 900, fontSize: 14, letterSpacing: '.01em' }}>{x.ro}</span>
                  {x.r.warranty && <span title="Warranty (red flag)" style={{ fontSize: 11 }}>🚩</span>}
                  <span title={x.sev.msg || x.sev.tag} style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 900, color: sevColor, background: `${sevColor}22`, border: `1px solid ${sevColor}66`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                    {x.age == null ? '—' : `${x.age}d`}
                  </span>
                  {x.flagged && <span title={`Flagged by ${x.a.flaggedBy || 'a manager'} ${when(x.a.flaggedAt)}`} style={{ fontSize: 13 }}>🚩</span>}
                </div>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.r.vehicle || '—'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 10.5, color: '#94a3b8', minWidth: 0 }}>
                  <span style={{ color: sevColor, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.sev.sev > 0 ? x.sev.tag : prettyRoStatus(x.r.roStatus) || '—'}</span>
                  {x.r.tech && <span style={{ whiteSpace: 'nowrap' }}>· 🔧 {String(x.r.tech).split(/\s+/)[0]}</span>}
                  <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', color: x.notes.length ? '#7dd3fc' : '#64748b', fontWeight: 700 }}>💬 {x.notes.length}</span>
                </div>
                {needsAnswer && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 800, color: '#fca5a5' }}>Manager wants an update — add a note.</div>}
              </div>

              {isOpen && (
                <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 6 }}>
                  <div style={{ fontSize: 10.5, color: '#64748b' }}>
                    Opened {x.r.openDate || '—'}{x.r.roStatus ? ` · ${prettyRoStatus(x.r.roStatus)}` : ''}{x.r.cpStatus ? ` · CP ${prettyRoStatus(x.r.cpStatus)}` : ''}
                    {x.a && x.a.answeredAt && !x.flagged && <div style={{ color: '#6ee7b7', marginTop: 2 }}>✓ Updated by {x.a.answeredBy} {when(x.a.answeredAt)}{x.a.flaggedBy ? ` (flagged by ${x.a.flaggedBy})` : ''}</div>}
                  </div>
                  {renderThread(x.notes)}
                  {canNote && (
                    <div style={{ marginTop: 8 }}>
                      <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(x); } }}
                        placeholder={isManager ? 'Ask about this RO…' : 'Why is this RO still open?'}
                        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(56,189,248,.4)', borderRadius: 8, color: '#e2e8f0', padding: '7px 9px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', resize: 'none' }} />
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                        <button onClick={() => addNote(x)} disabled={busy === x.ro || !draft.trim()}
                          style={{ background: 'rgba(56,189,248,.15)', border: '1px solid rgba(56,189,248,.45)', color: draft.trim() ? '#7dd3fc' : '#64748b', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: draft.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                          {busy === x.ro ? '…' : 'Add note'}
                        </button>
                        <div style={{ flex: 1 }} />
                        {canFlag && (
                          <button onClick={() => toggleFlag(x)} disabled={busy === x.ro} title={x.flagged ? 'Clear the flag' : 'Flag — the advisor gets a popup asking for an update'}
                            style={{ background: x.flagged ? 'rgba(248,113,113,.2)' : 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.5)', color: '#fca5a5', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                            {x.flagged ? '🚩 Unflag' : '🚩 Flag'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Recently closed threads */}
        {!loading && closed.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button onClick={() => setShowClosed(o => !o)}
              style={{ width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', color: '#94a3b8', borderRadius: 10, padding: '7px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              {showClosed ? '▾' : '▸'} Recently closed · {closed.length}
            </button>
            {showClosed && closed.map(c => (
              <div key={c.ro} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '8px 11px', marginTop: 6, opacity: .85 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 900, fontSize: 13, color: '#cbd5e1' }}>{c.ro}</span>
                  <span style={{ fontSize: 10.5, color: '#6ee7b7', fontWeight: 800, marginLeft: 'auto' }}>✓ off the open list</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{c.a.vehicle || ''}{c.a.lastSeenOpen ? ` · last open ${when(c.a.lastSeenOpen)}` : ''}</div>
                {renderThread(c.notes)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
