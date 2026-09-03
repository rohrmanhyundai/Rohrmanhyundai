import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  saveAdvisorNotes, loadAdvisorNotes,
  loadUsers, getGithubToken, setGithubToken,
} from '../utils/github';

// Appointment prep for one calendar day. The After Call Report used to live at
// the bottom of this page; it is now its own page (AfterCallReport.jsx), reached
// from the "After Call Reviews" button, since a tech's surveys have nothing to
// do with whichever day was clicked to get here.
//
// This is a working list, not a form that gets filled in once: it autosaves,
// it sorts itself by appointment time, and each row carries a status the
// advisor taps forward as the car moves through the day.

const genRowId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const EMPTY_ROW = () => ({
  id: genRowId(),
  customerName: '', appointmentTime: '', criticalDeferredService: '',
  waiter: false, dropOff: false, technician: '', notes: [], status: 'scheduled',
});

const STATUSES = [
  { key: 'scheduled', label: 'Scheduled', fg: '#94a3b8', bg: 'rgba(148,163,184,.14)', line: 'rgba(148,163,184,.45)' },
  { key: 'arrived',   label: 'Arrived',   fg: '#fbbf24', bg: 'rgba(251,191,36,.16)',  line: 'rgba(251,191,36,.55)' },
  { key: 'in-shop',   label: 'In Shop',   fg: '#38bdf8', bg: 'rgba(56,189,248,.16)',  line: 'rgba(56,189,248,.55)' },
  { key: 'done',      label: 'Done',      fg: '#4ade80', bg: 'rgba(74,222,128,.16)',  line: 'rgba(74,222,128,.55)' },
];
const statusMeta = (key) => STATUSES.find(s => s.key === key) || STATUSES[0];
const nextStatus = (key) => {
  const i = STATUSES.findIndex(s => s.key === key);
  return STATUSES[(i < 0 ? 0 : i + 1) % STATUSES.length].key;
};

// Appointment time is free text and always has been ("9", "9:00", "9:00 AM",
// "0900", "1:30pm"). Anything we can't read sorts to the bottom rather than
// being reordered on a guess.
function timeToMinutes(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h > 23 || min > 59) return null;
  const ampm = (m[3] || '').replace(/\./g, '');
  if (ampm.startsWith('p') && h < 12) h += 12;
  if (ampm.startsWith('a') && h === 12) h = 0;
  // No am/pm on a shop schedule: 1–6 means afternoon, 7–12 means morning.
  if (!ampm && h >= 1 && h <= 6) h += 12;
  return h * 60 + min;
}

function sortRows(rows) {
  return rows
    .map((r, i) => ({ r, i, t: timeToMinutes(r.appointmentTime) }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;   // keep entry order
      if (a.t === null) return 1;                            // blanks last
      if (b.t === null) return -1;
      return a.t !== b.t ? a.t - b.t : a.i - b.i;
    })
    .map(x => x.r);
}

function parseNotesField(notes) {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes.filter(e => e && e.text);
  const m = String(notes).match(/^\[([^\]]+)\]\n([\s\S]*)$/);
  if (m) return [{ author: m[1], text: m[2] }];
  if (String(notes).trim()) return [{ author: null, body: String(notes).trim() }];
  return [];
}

const SAVE_IDLE_MS = 4000; // quiet period before an autosave fires

export default function AdvisorDayForm({ advisorName, ownAdvisor, date, onBack }) {
  // ── Appointment prep ──────────────────────────────────────────────────────
  const [rows, setRows]     = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | dirty | saving | saved | error
  const [saveError, setSaveError] = useState('');

  // ── Notes modal ───────────────────────────────────────────────────────────
  const [notesOpen, setNotesOpen]       = useState(null); // row id
  const [notesEntries, setNotesEntries] = useState([]);
  const [newNoteDraft, setNewNoteDraft] = useState('');

  const notesRef         = useRef(null);
  const rowsRef          = useRef(rows);
  const notesEntriesRef  = useRef(notesEntries);
  const newNoteDraftRef  = useRef(newNoteDraft);
  const loadedRef        = useRef(false);   // don't autosave the initial load
  const lastSavedRef     = useRef('');      // serialized rows as last written
  const saveTimerRef     = useRef(null);
  rowsRef.current        = rows;
  notesEntriesRef.current = notesEntries;
  newNoteDraftRef.current = newNoteDraft;

  // ── Load prep notes ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    loadAdvisorNotes(advisorName, date).then(data => {
      if (cancelled) return;
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        const loaded = sortRows(data.rows.map(r => ({
          ...EMPTY_ROW(), ...r,
          id: r.id || genRowId(),
          status: r.status || 'scheduled',
          notes: parseNotesField(r.notes),
        })));
        setRows(loaded);
        lastSavedRef.current = JSON.stringify(loaded);
      }
      loadedRef.current = true;
    }).catch(() => { loadedRef.current = true; });
    return () => { cancelled = true; };
  }, [advisorName, date]);

  // ── Notes modal close on outside click ───────────────────────────────────
  useEffect(() => {
    function handleClick(e) {
      if (notesOpen !== null && notesRef.current && !notesRef.current.contains(e.target)) commitNotes();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notesOpen, notesEntries, newNoteDraft]);

  // ── Autosave ──────────────────────────────────────────────────────────────
  // The page used to save only when you pressed Back, so a closed tab — or an
  // admin's "Force Refresh All Users", which reloads every browser — threw the
  // day away. Now it writes itself after a short quiet period.
  async function persist(currentRows) {
    const payload = JSON.stringify(currentRows);
    if (payload === lastSavedRef.current) return true;
    // Never prompt from an autosave: if this device has no save code yet, hold
    // the changes and let the Back button ask for it.
    if (!getGithubToken()) {
      try {
        const r = await loadUsers();
        if (r?.sharedSaveCode) setGithubToken(r.sharedSaveCode);
      } catch {}
      if (!getGithubToken()) { setSaveState('dirty'); return false; }
    }
    setSaveState('saving');
    try {
      await saveAdvisorNotes(advisorName, date, currentRows, []);
      lastSavedRef.current = payload;
      setSaveState('saved');
      setSaveError('');
      return true;
    } catch (err) {
      if (/bad credentials|unauthorized|401/i.test(err.message || '')) setGithubToken('');
      setSaveState('error');
      setSaveError(err.message || 'Save failed');
      return false;
    }
  }

  useEffect(() => {
    if (!loadedRef.current) return;
    if (JSON.stringify(rows) === lastSavedRef.current) return;
    setSaveState(s => (s === 'saving' ? s : 'dirty'));
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { persist(rowsRef.current); }, SAVE_IDLE_MS);
    return () => clearTimeout(saveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Last-ditch flush when the tab is hidden or closed. keepalive lets the
  // request outlive the page; it's best effort on top of the idle save.
  useEffect(() => {
    const flush = () => {
      if (JSON.stringify(rowsRef.current) !== lastSavedRef.current) persist(rowsRef.current);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advisorName, date]);

  function openNotes(id) {
    const row = rowsRef.current.find(r => r.id === id);
    setNotesEntries(parseNotesField(row?.notes));
    setNewNoteDraft('');
    setNotesOpen(id);
  }

  function commitNotes() {
    if (notesOpen !== null) {
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      setRows(prev => prev.map(r => r.id === notesOpen ? { ...r, notes: entries } : r));
    }
    setNotesOpen(null); setNotesEntries([]); setNewNoteDraft('');
  }

  function deleteEntry(i) { setNotesEntries(prev => prev.filter((_, j) => j !== i)); }

  // ── Prep row helpers ──────────────────────────────────────────────────────
  // Rows are addressed by id, never by index — the list reorders itself.
  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }
  // Re-sort on blur rather than on every keystroke, so a row can't jump out
  // from under the cursor while its time is being typed.
  function resort() { setRows(prev => sortRows(prev)); }
  function addRow()      { setRows(prev => [...prev, EMPTY_ROW()]); }
  function removeRow(id) { if (rows.length > 1) setRows(prev => prev.filter(r => r.id !== id)); }
  function advanceStatus(id) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, status: nextStatus(r.status) } : r));
  }

  // ── Ensure token ──────────────────────────────────────────────────────────
  async function ensureToken(prompt_msg) {
    if (!getGithubToken()) {
      try {
        const result = await loadUsers();
        const shared = result?.sharedSaveCode;
        if (shared) { setGithubToken(shared); return true; }
      } catch {}
      const code = prompt(prompt_msg || 'Enter save code:');
      if (!code) return false;
      setGithubToken(code.trim());
    }
    return true;
  }

  // ── Save prep notes ───────────────────────────────────────────────────────
  async function handleSave() {
    clearTimeout(saveTimerRef.current);
    let currentRows = rowsRef.current;
    if (notesOpen !== null) {
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      currentRows = rowsRef.current.map(r => r.id === notesOpen ? { ...r, notes: entries } : r);
      setRows(currentRows);
      setNotesOpen(null); setNotesEntries([]); setNewNoteDraft('');
    }
    if (JSON.stringify(currentRows) === lastSavedRef.current) return;
    if (!await ensureToken('This device needs a one-time save code.\n\nEnter the save code (ask your admin for it):')) return;
    setSaving(true);
    try {
      await saveAdvisorNotes(advisorName, date, currentRows, []);
      lastSavedRef.current = JSON.stringify(currentRows);
      setSaveState('saved');
    } catch (err) {
      if (/bad credentials|unauthorized|401/i.test(err.message)) setGithubToken('');
      setSaving(false); throw err;
    } finally { setSaving(false); }
  }

  // ── Display helpers ───────────────────────────────────────────────────────
  const [y, m, d] = date.split('-');
  const displayDate = new Date(+y, +m - 1, +d).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const openModalRow = notesOpen !== null ? rows.find(r => r.id === notesOpen) : null;

  const tally = useMemo(() => {
    const filled = rows.filter(r => (r.customerName || '').trim() || (r.appointmentTime || '').trim());
    const by = k => filled.filter(r => (r.status || 'scheduled') === k).length;
    return {
      total: filled.length,
      scheduled: by('scheduled'), arrived: by('arrived'),
      inShop: by('in-shop'), done: by('done'),
      waiters: filled.filter(r => r.waiter && (r.status || 'scheduled') !== 'done').length,
    };
  }, [rows]);

  const saveLabel = saveState === 'saving' ? '⏳ Saving…'
    : saveState === 'saved' ? '✓ Saved'
    : saveState === 'error' ? `⚠️ Not saved — ${saveError}`
    : saveState === 'dirty' ? '● Unsaved changes'
    : '';
  const saveColor = saveState === 'saved' ? '#4ade80'
    : saveState === 'error' ? '#fca5a5'
    : saveState === 'dirty' ? '#fbbf24' : '#7a92b8';

  function NotesBtn({ row }) {
    const entries = parseNotesField(row.notes);
    const hasNotes = entries.length > 0;
    const hasOther = entries.some(e => e.author && e.author !== ownAdvisor);
    return (
      <button
        className={`secondary adv-notes-btn${hasNotes ? ' adv-notes-btn--active' : ''}${hasOther ? ' adv-notes-btn--other' : ''}`}
        onClick={() => openNotes(row.id)}
      >
        Notes{hasNotes ? ` (${entries.length})` : ''}
      </button>
    );
  }

  const pill = (n, label, color) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, color: '#cbd5e1',
    }}>
      <strong style={{ color, fontSize: 14 }}>{n}</strong> {label}
    </span>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="adv-page adv-form-page">

      {/* Top bar */}
      <div className="adv-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="secondary" disabled={saving} onClick={async () => {
            try {
              await handleSave(); onBack();
            } catch (err) {
              const isBad = /bad credentials|unauthorized|401/i.test(err.message);
              if (isBad) {
                setGithubToken('');
                let ok = false;
                try {
                  const r = await loadUsers();
                  if (r?.sharedSaveCode) { setGithubToken(r.sharedSaveCode); await handleSave(); onBack(); ok = true; }
                } catch {}
                if (!ok) {
                  const c = prompt('Save code expired. Enter a new one:');
                  if (c) { setGithubToken(c.trim()); try { await handleSave(); onBack(); } catch (e2) { alert('Save failed: ' + e2.message); } }
                }
              } else { alert('Save failed: ' + err.message); }
            }
          }}>
            {saving ? 'Saving...' : '← Back to Calendar'}
          </button>
          {advisorName !== ownAdvisor && (
            <span style={{ fontSize: 13, color: 'var(--cyan)', fontWeight: 700 }}>Editing: {advisorName}'s Calendar</span>
          )}
          {saveLabel && (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: saveColor }}>{saveLabel}</span>
          )}
        </div>
        <button className="secondary" onClick={() => window.print()}>Print</button>
      </div>

      <div className="adv-form-wrap">

        {/* ── Appointment Prep ── */}
        <div className="adv-section">
          <div className="adv-form-header">
            <h2 className="adv-form-title">ADVISOR NEXT DAY APPOINTMENT PREPARATION</h2>
            <div className="adv-form-meta">
              <span>Advisor Name: <strong>{advisorName}</strong></span>
              <span>Date: <strong>{displayDate}</strong></span>
            </div>
          </div>

          {/* Where the day stands, at a glance */}
          {tally.total > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', margin: '0 0 16px' }}>
              {pill(tally.total, tally.total === 1 ? 'appointment' : 'appointments', '#e2e8f0')}
              {tally.scheduled > 0 && pill(tally.scheduled, 'not here yet', '#94a3b8')}
              {tally.arrived > 0 && pill(tally.arrived, 'arrived', '#fbbf24')}
              {tally.inShop > 0 && pill(tally.inShop, 'in shop', '#38bdf8')}
              {tally.done > 0 && pill(tally.done, 'done', '#4ade80')}
              {tally.waiters > 0 && pill(tally.waiters, 'waiters left', '#f97316')}
            </div>
          )}

          <table className="adv-table">
            <thead>
              <tr>
                <th>STATUS</th>
                <th>CUSTOMER NAME</th><th>APPOINTMENT TIME</th><th>CRITICAL DEFERRED SERVICE</th>
                <th>WAITER / DROP OFF</th><th>TECHNICIAN</th><th className="no-print adv-action-col"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const st = statusMeta(row.status);
                const isDone = row.status === 'done';
                return (
                  <tr key={row.id}
                      className={parseNotesField(row.notes).length > 0 ? 'adv-row-has-notes' : ''}
                      style={isDone ? { opacity: 0.5 } : undefined}>
                    <td>
                      <button
                        onClick={() => advanceStatus(row.id)}
                        title="Tap to move it forward"
                        style={{
                          width: '100%', background: st.bg, border: `1px solid ${st.line}`,
                          color: st.fg, borderRadius: 999, padding: '6px 10px',
                          fontSize: 12, fontWeight: 800, cursor: 'pointer',
                          whiteSpace: 'nowrap', fontFamily: 'inherit',
                        }}>
                        {st.label}
                      </button>
                    </td>
                    <td><input className="adv-cell-input" value={row.customerName} onChange={e => updateRow(row.id, 'customerName', e.target.value)} placeholder="Customer name" /></td>
                    <td><input className="adv-cell-input" value={row.appointmentTime} onChange={e => updateRow(row.id, 'appointmentTime', e.target.value)} onBlur={resort} placeholder="e.g. 9:00 AM" /></td>
                    <td><input className="adv-cell-input" value={row.criticalDeferredService} onChange={e => updateRow(row.id, 'criticalDeferredService', e.target.value)} placeholder="Deferred service notes" /></td>
                    <td className="adv-waiter-cell">
                      <div className="adv-check-pair">
                        <label className="adv-check-label"><input type="checkbox" className="adv-checkbox" checked={row.waiter} onChange={e => updateRow(row.id, 'waiter', e.target.checked)} /><span>Waiter</span></label>
                        <label className="adv-check-label"><input type="checkbox" className="adv-checkbox" checked={row.dropOff} onChange={e => updateRow(row.id, 'dropOff', e.target.checked)} /><span>Drop Off</span></label>
                      </div>
                    </td>
                    <td><input className="adv-cell-input" value={row.technician} onChange={e => updateRow(row.id, 'technician', e.target.value)} placeholder="Tech name" /></td>
                    <td className="no-print adv-action-col">
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <NotesBtn row={row} />
                        <button className="secondary adv-del-btn" onClick={() => removeRow(row.id)} disabled={rows.length <= 1}>×</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="no-print" style={{ marginTop: 14 }}>
            <button onClick={addRow}>+ Add Row</button>
          </div>
        </div>

      </div>

      {/* ── Notes Modal (Appointment Prep) ── */}
      {notesOpen !== null && (
        <div className="adv-notes-overlay no-print">
          <div className="adv-notes-modal" ref={notesRef}>
            <div className="adv-notes-modal-header">
              <span>Notes — {openModalRow?.customerName || 'appointment'}</span>
              <button className="secondary adv-del-btn" onClick={commitNotes}>×</button>
            </div>
            <div className="adv-notes-entries">
              {notesEntries.length === 0 ? (
                <div className="adv-notes-empty">No notes yet — add one below.</div>
              ) : notesEntries.map((entry, i) => (
                <div key={i} className="adv-notes-entry">
                  <div className="adv-notes-entry-body">
                    {entry.author && <span className={entry.author !== ownAdvisor ? 'adv-notes-entry-author adv-notes-entry-author--other' : 'adv-notes-entry-author'}>{entry.author}&mdash;&nbsp;</span>}
                    <span className="adv-notes-entry-text">{entry.text}</span>
                  </div>
                  {(!entry.author || entry.author === ownAdvisor) && (
                    <button className="secondary adv-del-btn adv-notes-entry-del" onClick={() => deleteEntry(i)}>×</button>
                  )}
                </div>
              ))}
            </div>
            <div className="adv-notes-add-row">
              <span className="adv-notes-add-who">{ownAdvisor}—</span>
              <textarea className="adv-notes-textarea adv-notes-new-input" autoFocus value={newNoteDraft} onChange={e => setNewNoteDraft(e.target.value)} placeholder="Type your note here..." rows={3} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={commitNotes}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
