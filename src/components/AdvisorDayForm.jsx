import React, { useState, useEffect, useRef } from 'react';
import { saveAdvisorNotes, loadAdvisorNotes } from '../utils/github';

const EMPTY_ROW = () => ({ customerName: '', appointmentTime: '', criticalDeferredService: '', waiter: false, technician: '', notes: '' });

export default function AdvisorDayForm({ advisorName, ownAdvisor, date, onBack }) {
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [notesOpen, setNotesOpen] = useState(null); // index of row whose notes are open
  const [notesDraft, setNotesDraft] = useState('');
  const notesRef = useRef(null);

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
      setRows(prev => prev.map((r, i) => i === notesOpen ? { ...r, notes: notesDraft } : r));
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
    setSaving(true);
    setSaveStatus('');
    try {
      await saveAdvisorNotes(advisorName, date, rows);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      alert('Save failed: ' + err.message);
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
          <button className="secondary" disabled={saving} onClick={async () => { try { await handleSave(); } catch {} onBack(); }}>
            ← Back to Calendar
          </button>
          {advisorName !== ownAdvisor && (
            <span style={{ fontSize: 13, color: 'var(--cyan)', fontWeight: 700 }}>
              Editing: {advisorName}'s Calendar
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={() => window.print()}>Print</button>
          <button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : 'Save to GitHub'}
          </button>
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
            {rows.map((row, idx) => (
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
                      className={`secondary adv-notes-btn${row.notes ? ' adv-notes-btn--active' : ''}`}
                      onClick={() => openNotes(idx)}
                      title={row.notes ? 'Edit notes' : 'Add notes'}
                    >Notes</button>
                    <button className="secondary adv-del-btn" onClick={() => removeRow(idx)}
                      disabled={rows.length <= 1}>×</button>
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

      {/* Notes modal */}
      {notesOpen !== null && (
        <div className="adv-notes-overlay no-print">
          <div className="adv-notes-modal" ref={notesRef}>
            <div className="adv-notes-modal-header">
              <span>Notes — {rows[notesOpen]?.customerName || `Row ${notesOpen + 1}`}</span>
              <button className="secondary adv-del-btn" onClick={commitNotes}>×</button>
            </div>
            <textarea
              className="adv-notes-textarea"
              autoFocus
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
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
