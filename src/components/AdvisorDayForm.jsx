import React, { useState, useEffect, useRef } from 'react';
import {
  saveAdvisorNotes, loadAdvisorNotes,
  loadUsers, getGithubToken, setGithubToken,
} from '../utils/github';

// Appointment prep for one calendar day. The After Call Report used to live at
// the bottom of this page; it is now its own page (AfterCallReport.jsx), reached
// from the "After Call Reviews" button, since a tech's surveys have nothing to
// do with whichever day was clicked to get here.

const EMPTY_ROW = () => ({
  customerName: '', appointmentTime: '', criticalDeferredService: '',
  waiter: false, dropOff: false, technician: '', notes: []
});

function parseNotesField(notes) {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes.filter(e => e && e.text);
  const m = String(notes).match(/^\[([^\]]+)\]\n([\s\S]*)$/);
  if (m) return [{ author: m[1], text: m[2] }];
  if (String(notes).trim()) return [{ author: null, body: String(notes).trim() }];
  return [];
}

export default function AdvisorDayForm({ advisorName, ownAdvisor, date, onBack }) {
  // ── Appointment prep ──────────────────────────────────────────────────────
  const [rows, setRows]     = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [saving, setSaving] = useState(false);

  // ── Notes modal ───────────────────────────────────────────────────────────
  const [notesOpen, setNotesOpen]       = useState(null);
  const [notesEntries, setNotesEntries] = useState([]);
  const [newNoteDraft, setNewNoteDraft] = useState('');

  const notesRef         = useRef(null);
  const rowsRef          = useRef(rows);
  const notesEntriesRef  = useRef(notesEntries);
  const newNoteDraftRef  = useRef(newNoteDraft);
  rowsRef.current        = rows;
  notesEntriesRef.current = notesEntries;
  newNoteDraftRef.current = newNoteDraft;

  // ── Load prep notes ───────────────────────────────────────────────────────
  useEffect(() => {
    loadAdvisorNotes(advisorName, date).then(data => {
      if (!data) return;
      if (Array.isArray(data.rows) && data.rows.length > 0)
        setRows(data.rows.map(r => ({ ...EMPTY_ROW(), ...r, notes: parseNotesField(r.notes) })));
    });
  }, [advisorName, date]);

  // ── Notes modal close on outside click ───────────────────────────────────
  useEffect(() => {
    function handleClick(e) {
      if (notesOpen !== null && notesRef.current && !notesRef.current.contains(e.target)) commitNotes();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notesOpen, notesEntries, newNoteDraft]);

  function openNotes(idx) {
    setNotesEntries(parseNotesField(rows[idx].notes));
    setNewNoteDraft('');
    setNotesOpen(idx);
  }

  function commitNotes() {
    if (notesOpen !== null) {
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      setRows(prev => prev.map((r, i) => i === notesOpen ? { ...r, notes: entries } : r));
    }
    setNotesOpen(null); setNotesEntries([]); setNewNoteDraft('');
  }

  function deleteEntry(i) { setNotesEntries(prev => prev.filter((_, j) => j !== i)); }

  // ── Prep row helpers ──────────────────────────────────────────────────────
  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }
  function addRow()       { setRows(prev => [...prev, EMPTY_ROW()]); }
  function removeRow(idx) { if (rows.length > 1) setRows(prev => prev.filter((_, i) => i !== idx)); }

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
    let currentRows = rowsRef.current;
    if (notesOpen !== null) {
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      currentRows = rowsRef.current.map((r, i) => i === notesOpen ? { ...r, notes: entries } : r);
      setRows(currentRows);
      setNotesOpen(null); setNotesEntries([]); setNewNoteDraft('');
    }
    if (!await ensureToken('This device needs a one-time save code.\n\nEnter the save code (ask your admin for it):')) return;
    setSaving(true);
    try {
      await saveAdvisorNotes(advisorName, date, currentRows, []);
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
  const openModalRow = notesOpen !== null ? rows[notesOpen] : null;

  function NotesBtn({ idx, row }) {
    const entries = parseNotesField(row.notes);
    const hasNotes = entries.length > 0;
    const hasOther = entries.some(e => e.author && e.author !== ownAdvisor);
    return (
      <button
        className={`secondary adv-notes-btn${hasNotes ? ' adv-notes-btn--active' : ''}${hasOther ? ' adv-notes-btn--other' : ''}`}
        onClick={() => openNotes(idx)}
      >
        Notes{hasNotes ? ` (${entries.length})` : ''}
      </button>
    );
  }

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
          <table className="adv-table">
            <thead>
              <tr>
                <th>CUSTOMER NAME</th><th>APPOINTMENT TIME</th><th>CRITICAL DEFERRED SERVICE</th>
                <th>WAITER / DROP OFF</th><th>TECHNICIAN</th><th className="no-print adv-action-col"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className={parseNotesField(row.notes).length > 0 ? 'adv-row-has-notes' : ''}>
                  <td><input className="adv-cell-input" value={row.customerName} onChange={e => updateRow(idx, 'customerName', e.target.value)} placeholder="Customer name" /></td>
                  <td><input className="adv-cell-input" value={row.appointmentTime} onChange={e => updateRow(idx, 'appointmentTime', e.target.value)} placeholder="e.g. 9:00 AM" /></td>
                  <td><input className="adv-cell-input" value={row.criticalDeferredService} onChange={e => updateRow(idx, 'criticalDeferredService', e.target.value)} placeholder="Deferred service notes" /></td>
                  <td className="adv-waiter-cell">
                    <div className="adv-check-pair">
                      <label className="adv-check-label"><input type="checkbox" className="adv-checkbox" checked={row.waiter} onChange={e => updateRow(idx, 'waiter', e.target.checked)} /><span>Waiter</span></label>
                      <label className="adv-check-label"><input type="checkbox" className="adv-checkbox" checked={row.dropOff} onChange={e => updateRow(idx, 'dropOff', e.target.checked)} /><span>Drop Off</span></label>
                    </div>
                  </td>
                  <td><input className="adv-cell-input" value={row.technician} onChange={e => updateRow(idx, 'technician', e.target.value)} placeholder="Tech name" /></td>
                  <td className="no-print adv-action-col">
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <NotesBtn idx={idx} row={row} />
                      <button className="secondary adv-del-btn" onClick={() => removeRow(idx)} disabled={rows.length <= 1}>×</button>
                    </div>
                  </td>
                </tr>
              ))}
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
              <span>Notes — {openModalRow?.customerName || `Row ${notesOpen + 1}`}</span>
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
