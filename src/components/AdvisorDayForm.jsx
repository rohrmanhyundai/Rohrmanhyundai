import React, { useState, useEffect, useRef } from 'react';
import { saveAdvisorNotes, loadAdvisorNotes, getGithubToken, setGithubToken } from '../utils/github';

const EMPTY_ROW = () => ({ customerName: '', appointmentTime: '', criticalDeferredService: '', waiter: false, technician: '', notes: '' });

// Parse "[AUTHORNAME]\nbody" format — returns { author, body }
function parseNote(text) {
  const m = (text || '').match(/^\[([^\]]+)\]\n([\s\S]*)$/);
  return m ? { author: m[1], body: m[2] } : { author: null, body: text || '' };
}

// Stamp a note with the editor's name if it hasn't been stamped yet
function stampNote(draft, editorName) {
  if (!draft.trim()) return draft;
  if (parseNote(draft).author) return draft; // already stamped
  return `[${editorName}]\n${draft}`;
}

export default function AdvisorDayForm({ advisorName, ownAdvisor, date, onBack }) {
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [notesOpen, setNotesOpen] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const notesRef = useRef(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const isGuest = advisorName !== ownAdvisor; // viewing someone else's calendar

  useEffect(() => {
    loadAdvisorNotes(advisorName, date).then(data => {
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        setRows(data.rows.map(r => ({ ...EMPTY_ROW(), ...r })));
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
  }, [notesOpen, notesDraft]);

  function openNotes(idx) {
    setNotesDraft(rows[idx].notes || '');
    setNotesOpen(idx);
  }

  function commitNotes() {
    if (notesOpen !== null) {
      const finalDraft = isGuest ? stampNote(notesDraft, ownAdvisor) : notesDraft;
      setRows(prev => prev.map((r, i) => i === notesOpen ? { ...r, notes: finalDraft } : r));
    }
    setNotesOpen(null);
    setNotesDraft('');
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
      const finalDraft = isGuest ? stampNote(notesDraft, ownAdvisor) : notesDraft;
      currentRows = rowsRef.current.map((r, i) => i === notesOpen ? { ...r, notes: finalDraft } : r);
      setRows(currentRows);
      setNotesOpen(null);
      setNotesDraft('');
    }

    if (!getGithubToken()) {
      const code = prompt(
        'This device needs a one-time save code to save appointment notes.\n\nEnter the save code (ask your admin for it):'
      );
      if (!code) throw new Error('No save code entered.');
      setGithubToken(code.trim());
    }

    setSaving(true);
    setSaveStatus('');
    try {
      await saveAdvisorNotes(advisorName, date, currentRows);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      setSaving(false);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  // Derive author/body from notesDraft for modal display
  const { author: noteAuthor, body: noteBody } = parseNote(notesDraft);

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
          {isGuest && (
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
              const { author: rowNoteAuthor } = parseNote(row.notes);
              const noteFromOther = rowNoteAuthor && rowNoteAuthor !== advisorName;
              return (
                <tr key={idx} className={row.notes ? 'adv-row-has-notes' : ''}>
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
                        className={`secondary adv-notes-btn${row.notes ? ' adv-notes-btn--active' : ''}${noteFromOther ? ' adv-notes-btn--other' : ''}`}
                        onClick={() => openNotes(idx)}
                        title={noteFromOther ? `Note left by ${rowNoteAuthor}` : row.notes ? 'Edit notes' : 'Add notes'}
                      >Notes</button>
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

            {/* Show red author badge if note was left by someone else */}
            {noteAuthor && noteAuthor !== advisorName && (
              <div className="adv-note-author">
                ✎ Note left by {noteAuthor}
              </div>
            )}

            {/* Show editing-as badge when guest is writing */}
            {isGuest && !noteAuthor && (
              <div className="adv-note-author adv-note-author--writing">
                ✎ You are adding a note as {ownAdvisor}
              </div>
            )}

            <textarea
              className="adv-notes-textarea"
              autoFocus
              value={noteBody}
              onChange={e => {
                const author = noteAuthor || (isGuest ? ownAdvisor : null);
                setNotesDraft(author ? `[${author}]\n${e.target.value}` : e.target.value);
              }}
              placeholder="Add notes for this appointment..."
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={commitNotes}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
