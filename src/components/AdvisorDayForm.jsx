import React, { useState, useEffect, useRef } from 'react';
import { saveAdvisorNotes, loadAdvisorNotes, getGithubToken, setGithubToken } from '../utils/github';

const EMPTY_ROW = () => ({ customerName: '', appointmentTime: '', criticalDeferredService: '', waiter: false, technician: '', notes: [] });

// Convert any saved notes format into an array of { author, text } entries
function parseNotesField(notes) {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes.filter(e => e && e.text);
  // Legacy string format: "[AUTHOR]\nbody"
  const m = String(notes).match(/^\[([^\]]+)\]\n([\s\S]*)$/);
  if (m) return [{ author: m[1], text: m[2] }];
  if (String(notes).trim()) return [{ author: null, text: String(notes).trim() }];
  return [];
}

export default function AdvisorDayForm({ advisorName, ownAdvisor, date, onBack }) {
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [saving, setSaving] = useState(false);
  const [notesOpen, setNotesOpen] = useState(null);   // row index of open modal
  const [notesEntries, setNotesEntries] = useState([]); // entries for the open row
  const [newNoteDraft, setNewNoteDraft] = useState(''); // text being typed for new entry
  const notesRef = useRef(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const notesEntriesRef = useRef(notesEntries);
  notesEntriesRef.current = notesEntries;
  const newNoteDraftRef = useRef(newNoteDraft);
  newNoteDraftRef.current = newNoteDraft;

  useEffect(() => {
    loadAdvisorNotes(advisorName, date).then(data => {
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        setRows(data.rows.map(r => ({ ...EMPTY_ROW(), ...r, notes: parseNotesField(r.notes) })));
      }
    });
  }, [advisorName, date]);

  // Close notes modal on outside click
  useEffect(() => {
    function handleClick(e) {
      if (notesOpen !== null && notesRef.current && !notesRef.current.contains(e.target)) {
        commitNotes();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notesOpen, notesEntries, newNoteDraft]);

  function openNotes(idx) {
    setNotesEntries(parseNotesField(rows[idx].notes));
    setNewNoteDraft('');
    setNotesOpen(idx);
  }

  // Flush pending draft entry and write back to rows
  function commitNotes() {
    if (notesOpen !== null) {
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      setRows(prev => prev.map((r, i) => i === notesOpen ? { ...r, notes: entries } : r));
    }
    setNotesOpen(null);
    setNotesEntries([]);
    setNewNoteDraft('');
  }

  function deleteEntry(entryIdx) {
    setNotesEntries(prev => prev.filter((_, i) => i !== entryIdx));
  }

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  function addRow() {
    setRows(prev => [...prev, EMPTY_ROW()]);
  }

  function removeRow(idx) {
    if (rows.length <= 1) return;
    setRows(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    let currentRows = rowsRef.current;
    if (notesOpen !== null) {
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      currentRows = rowsRef.current.map((r, i) => i === notesOpen ? { ...r, notes: entries } : r);
      setRows(currentRows);
      setNotesOpen(null);
      setNotesEntries([]);
      setNewNoteDraft('');
    }

    if (!getGithubToken()) {
      const code = prompt(
        'This device needs a one-time save code to save appointment notes.\n\nEnter the save code (ask your admin for it):'
      );
      if (!code) throw new Error('No save code entered.');
      setGithubToken(code.trim());
    }

    setSaving(true);
    try {
      await saveAdvisorNotes(advisorName, date, currentRows);
    } catch (err) {
      setSaving(false);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  const [y, m, d] = date.split('-');
  const displayDate = new Date(+y, +m - 1, +d).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return (
    <div className="adv-page adv-form-page">
      {/* Top bar */}
      <div className="adv-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="secondary" disabled={saving} onClick={async () => {
            try {
              await handleSave();
              onBack();
            } catch (err) {
              alert('Save failed: ' + err.message);
            }
          }}>
            {saving ? 'Saving...' : '← Back to Calendar'}
          </button>
          {advisorName !== ownAdvisor && (
            <span style={{ fontSize: 13, color: 'var(--cyan)', fontWeight: 700 }}>
              Editing: {advisorName}'s Calendar
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      {/* Printable form area */}
      <div className="adv-form-wrap">
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
              <th>CUSTOMER NAME</th>
              <th>APPOINTMENT TIME</th>
              <th>CRITICAL DEFERRED SERVICE</th>
              <th>WAITER</th>
              <th>TECHNICIAN</th>
              <th className="no-print adv-action-col"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const entries = parseNotesField(row.notes);
              const hasNotes = entries.length > 0;
              const hasOtherNotes = entries.some(e => e.author && e.author !== ownAdvisor);
              return (
                <tr key={idx} className={hasNotes ? 'adv-row-has-notes' : ''}>
                  <td>
                    <input className="adv-cell-input" value={row.customerName}
                      onChange={e => updateRow(idx, 'customerName', e.target.value)} placeholder="Customer name" />
                  </td>
                  <td>
                    <input className="adv-cell-input" value={row.appointmentTime}
                      onChange={e => updateRow(idx, 'appointmentTime', e.target.value)} placeholder="e.g. 9:00 AM" />
                  </td>
                  <td>
                    <input className="adv-cell-input" value={row.criticalDeferredService}
                      onChange={e => updateRow(idx, 'criticalDeferredService', e.target.value)} placeholder="Deferred service notes" />
                  </td>
                  <td className="adv-waiter-cell">
                    <input type="checkbox" className="adv-checkbox" checked={row.waiter}
                      onChange={e => updateRow(idx, 'waiter', e.target.checked)} />
                  </td>
                  <td>
                    <input className="adv-cell-input" value={row.technician}
                      onChange={e => updateRow(idx, 'technician', e.target.value)} placeholder="Tech name" />
                  </td>
                  <td className="no-print adv-action-col">
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button
                        className={`secondary adv-notes-btn${hasNotes ? ' adv-notes-btn--active' : ''}${hasOtherNotes ? ' adv-notes-btn--other' : ''}`}
                        onClick={() => openNotes(idx)}
                        title={hasOtherNotes ? 'Has notes from other advisors' : hasNotes ? 'View / edit notes' : 'Add notes'}
                      >
                        Notes{hasNotes ? ` (${entries.length})` : ''}
                      </button>
                      <button className="secondary adv-del-btn" onClick={() => removeRow(idx)}
                        disabled={rows.length <= 1}>×</button>
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

      {/* Notes modal */}
      {notesOpen !== null && (
        <div className="adv-notes-overlay no-print">
          <div className="adv-notes-modal" ref={notesRef}>
            <div className="adv-notes-modal-header">
              <span>Notes — {rows[notesOpen]?.customerName || `Row ${notesOpen + 1}`}</span>
              <button className="secondary adv-del-btn" onClick={commitNotes}>×</button>
            </div>

            {/* Existing entries */}
            <div className="adv-notes-entries">
              {notesEntries.length === 0 ? (
                <div className="adv-notes-empty">No notes yet — add one below.</div>
              ) : (
                notesEntries.map((entry, i) => (
                  <div key={i} className="adv-notes-entry">
                    <div className="adv-notes-entry-body">
                      {entry.author && (
                        <span className={entry.author !== ownAdvisor ? 'adv-notes-entry-author adv-notes-entry-author--other' : 'adv-notes-entry-author'}>
                          {entry.author}&mdash;&nbsp;
                        </span>
                      )}
                      <span className="adv-notes-entry-text">{entry.text}</span>
                    </div>
                    {/* Only let the author (or ownAdvisor on their own calendar) delete their entry */}
                    {(!entry.author || entry.author === ownAdvisor) && (
                      <button className="secondary adv-del-btn adv-notes-entry-del" onClick={() => deleteEntry(i)} title="Remove this note">×</button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* New note input */}
            <div className="adv-notes-add-row">
              <span className="adv-notes-add-who">{ownAdvisor}—</span>
              <textarea
                className="adv-notes-textarea adv-notes-new-input"
                autoFocus
                value={newNoteDraft}
                onChange={e => setNewNoteDraft(e.target.value)}
                placeholder="Type your note here..."
                rows={3}
              />
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
