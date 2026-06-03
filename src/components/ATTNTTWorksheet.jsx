import React, { useState, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';
import { ATT_NTT_PDF_B64 } from '../assets/attNttPdfBase64';
import { loadGithubFile, saveGithubFile, getGithubToken } from '../utils/github';

const DEALER_CODE = 'IN007';
const SERVICE_MANAGER = 'Service Manager Shawn Laughner';

// Note-box geometry on the PDF: boxes TechNote2..TechNote27, each ~259pt wide
// and ~41pt tall (≈ 3 lines at 9pt). We wrap the tech notes ourselves so we
// know exactly when to spill into the next box below.
const NOTE_FIRST = 2;
const NOTE_LAST  = 27;
const CHARS_PER_LINE = 48;
const LINES_PER_BOX  = 3;

const inp = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13, outline: 'none',
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
};
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const section = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 };
const sectionTitle = { fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 };

function Field({ label, value, onChange, placeholder = '', type = 'text', readOnly = false }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type={type} value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} readOnly={readOnly}
        style={{ ...inp, ...(readOnly ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }} />
    </div>
  );
}

// "HH:MM" (24h) clock-on / clock-off → decimal hours, e.g. 8:00→9:30 = 1.50.
function decimalHours(onTime, offTime) {
  if (!onTime || !offTime) return '';
  const [oh, om] = onTime.split(':').map(Number);
  const [fh, fm] = offTime.split(':').map(Number);
  if ([oh, om, fh, fm].some(n => isNaN(n))) return '';
  let mins = (fh * 60 + fm) - (oh * 60 + om);
  if (mins < 0) mins += 24 * 60; // crossed midnight
  return (mins / 60).toFixed(2);
}

// Word-wrap to fixed width, honoring explicit newlines and hard-splitting long tokens.
function wrapToLines(text, maxChars) {
  const lines = [];
  (text || '').split('\n').forEach(para => {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = '';
    if (words.length === 0) { lines.push(''); return; }
    for (let w of words) {
      while (w.length > maxChars) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, maxChars)); w = w.slice(maxChars); }
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
  });
  return lines;
}

export default function ATTNTTWorksheet({ onBack, currentUser, currentRole }) {
  const today = new Date().toISOString().slice(0, 10);

  const [ro,           setRo]           = useState('');
  const [dealerCode,   setDealerCode]   = useState(DEALER_CODE);
  const [roDate,       setRoDate]       = useState(today);
  const [vin,          setVin]          = useState('');
  const [techlineCase, setTechlineCase] = useState('');
  const [opCode,       setOpCode]       = useState('');
  const [clockOn,      setClockOn]      = useState('');
  const [clockOff,     setClockOff]     = useState('');
  const [requestedHrs, setRequestedHrs] = useState('');
  const [techNotes,    setTechNotes]    = useState('');

  const [status,      setStatus]      = useState('');
  const [saving,      setSaving]      = useState(false);
  const [savedList,   setSavedList]   = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showUploads, setShowUploads] = useState(false);
  const [deletingId,  setDeletingId]  = useState(null);
  const [pdfLoading,  setPdfLoading]  = useState(null);

  const clockTotal = decimalHours(clockOn, clockOff);

  function refreshIndex() {
    setLoadingList(true);
    loadGithubFile('data/att-ntt-worksheets/index.json')
      .then(d => setSavedList(Array.isArray(d) ? d : []))
      .catch(() => setSavedList([]))
      .finally(() => setLoadingList(false));
  }
  useEffect(() => { refreshIndex(); }, []);

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  }

  function validate() {
    if (!vin || vin.length !== 17) { setStatus('❌ VIN must be exactly 17 characters.'); return false; }
    if (!techNotes.trim()) { setStatus('❌ Labor Operation Description (Tech Notes) is required.'); return false; }
    setStatus('');
    return true;
  }

  async function buildPdf(d) {
    const _ro           = d?.ro           ?? ro;
    const _dealerCode   = d?.dealerCode   ?? dealerCode;
    const _roDate       = d?.roDate       ?? roDate;
    const _vin          = d?.vin          ?? vin;
    const _techlineCase = d?.techlineCase ?? techlineCase;
    const _opCode       = d?.opCode       ?? opCode;
    const _clockOn      = d?.clockOn      ?? clockOn;
    const _clockOff     = d?.clockOff     ?? clockOff;
    const _requestedHrs = d?.requestedHrs ?? requestedHrs;
    const _techNotes    = d?.techNotes    ?? techNotes;
    const _clockTotal   = decimalHours(_clockOn, _clockOff);

    const raw   = atob(ATT_NTT_PDF_B64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const pdfDoc = await PDFDocument.load(bytes);
    const form   = pdfDoc.getForm();

    const setTxt = (name, value, size) => {
      if (value === undefined || value === null || value === '') return;
      try {
        const f = form.getTextField(name);
        // Some widgets (the multiline note boxes) have an inverted rectangle
        // (negative height). pdf-lib draws multiline text top-down using the
        // raw rect, so an inverted rect pushes the text off the visible box.
        // Normalize to a positive-height rect (same visual region) first.
        try {
          const w = f.acroField.getWidgets()[0];
          const r = w.getRectangle();
          if (r.height < 0) w.setRectangle({ x: r.x, y: r.y + r.height, width: r.width, height: -r.height });
        } catch {}
        if (size) { try { f.setFontSize(size); } catch {} }
        f.setText(String(value));
      } catch {}
    };

    // ── Header ──
    setTxt('DealerCode',  _dealerCode);
    setTxt('RODate',      fmtDate(_roDate));
    setTxt('VIN',         _vin);
    setTxt('caseNumTL',   _techlineCase);

    // ── Single labor-operation line (row 2) ──
    setTxt('LOP2',        _opCode);
    setTxt('OnTime2',     _clockOn);
    setTxt('OffTime2',    _clockOff);
    setTxt('ClockTime2',  _clockTotal);
    setTxt('LaborHours2', _requestedHrs);

    // ── Totals ──
    setTxt('Total Requested Hours',     _requestedHrs);
    setTxt('Total Clock Time Recorded', _clockTotal);

    // ── Tech notes: flow down the TechNote boxes, then the signature line ──
    const lines  = wrapToLines(_techNotes, CHARS_PER_LINE);
    const chunks = [];
    for (let i = 0; i < lines.length; i += LINES_PER_BOX) {
      chunks.push(lines.slice(i, i + LINES_PER_BOX).join('\n'));
    }
    let box = NOTE_FIRST;
    for (const chunk of chunks) {
      if (box > NOTE_LAST) break;
      setTxt(`TechNote${box}`, chunk, 9);
      box++;
    }
    // Service Manager line (with the date this PDF was generated) in the next
    // box after the notes.
    const madeDate = fmtDate(new Date().toISOString().slice(0, 10));
    if (box <= NOTE_LAST) setTxt(`TechNote${box}`, `${SERVICE_MANAGER}          Date: ${madeDate}`, 9);

    return pdfDoc.save();
  }

  async function openPdf(data) {
    const pdfBytes = await buildPdf(data);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (win) win.focus();
  }

  async function downloadPdf(data, roNum) {
    const pdfBytes = await buildPdf(data);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `ATT_NTT_Worksheet_${roNum || data?.vin || 'worksheet'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleViewSaved(item) {
    setPdfLoading(item.id + '_view');
    try {
      const d = await loadGithubFile(`data/att-ntt-worksheets/${item.id}.json`);
      if (!d) { alert('Could not load worksheet. Try again in a moment.'); return; }
      await openPdf(d);
    } catch (e) { alert(`Error: ${e.message}`); }
    finally { setPdfLoading(null); }
  }

  async function handleDownloadSaved(item) {
    setPdfLoading(item.id + '_dl');
    try {
      const d = await loadGithubFile(`data/att-ntt-worksheets/${item.id}.json`);
      if (!d) { alert('Could not load worksheet. Try again in a moment.'); return; }
      await downloadPdf(d, d.ro);
    } catch (e) { alert(`Error: ${e.message}`); }
    finally { setPdfLoading(null); }
  }

  async function handleDeleteSaved(item) {
    if (!window.confirm(`Delete worksheet ${item.ro || item.vin || item.id}? This cannot be undone.`)) return;
    setDeletingId(item.id);
    try {
      const newIndex = savedList.filter(s => s.id !== item.id);
      await saveGithubFile('data/att-ntt-worksheets/index.json', newIndex, `Delete worksheet ${item.id}`);
      setSavedList(newIndex);
    } catch (e) { alert(`Delete failed: ${e.message}`); }
    finally { setDeletingId(null); }
  }

  async function previewPdf() {
    if (!validate()) return;
    await openPdf(null);
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setStatus('⏳ Saving…');
    try {
      const id = `${ro || vin || 'ws'}_${Date.now().toString(36)}`;
      const data = {
        id, ro, dealerCode, roDate, vin, techlineCase, opCode,
        clockOn, clockOff, requestedHrs, techNotes,
        savedBy: currentUser, savedAt: new Date().toISOString(),
      };
      await saveGithubFile(`data/att-ntt-worksheets/${id}.json`, data);
      const newIndex = [{ id, ro, vin, roDate, savedBy: currentUser, savedAt: data.savedAt }, ...savedList];
      await saveGithubFile('data/att-ntt-worksheets/index.json', newIndex);
      setSavedList(newIndex);
      setStatus('✅ Saved! Other users can now open this worksheet.');
    } catch (e) { setStatus(`❌ ${e.message}`); }
    finally { setSaving(false); }
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div className="adv-topbar">
        <div>
          <div className="adv-title">📝 NTT / ATT Supplemental Worksheet</div>
          <div className="adv-sub">Bob Rohrman Hyundai — Warranty Department</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => { setShowUploads(true); refreshIndex(); }}
            style={{ background: 'rgba(139,92,246,.2)', border: '1px solid rgba(139,92,246,.5)', color: '#c4b5fd', borderRadius: 10, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>
            📂 View Uploads {savedList.length > 0 ? `(${savedList.length})` : ''}
          </button>
          <button className="secondary" onClick={onBack}>← Warranty Hub</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>

          {/* Basic Info */}
          <div style={section}>
            <div style={sectionTitle}>📋 Worksheet Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
              <Field label="Dealer Code" value={dealerCode} onChange={setDealerCode} />
              <Field label="RO Date" value={roDate} onChange={setRoDate} type="date" />
              <Field label="RO # (for your records)" value={ro} onChange={setRo} placeholder="optional" />
              <Field label="Techline Case #" value={techlineCase} onChange={setTechlineCase} />
              <Field label="WebLTS Op. Code" value={opCode} onChange={setOpCode} placeholder="e.g. 11AB12R0" />
            </div>
            <div style={{ marginTop: 14 }}>
              <Field label="VIN * (17 characters)" value={vin} onChange={v => setVin(v.toUpperCase().slice(0, 17))} placeholder="17-character VIN" />
              <div style={{ fontSize: 11, color: vin.length === 17 ? '#4ade80' : '#64748b', marginTop: 3 }}>{vin.length}/17 characters</div>
            </div>
          </div>

          {/* Time + Hours */}
          <div style={section}>
            <div style={sectionTitle}>⏱ Clock Time & Hours</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
              <Field label="Clock On Time" value={clockOn} onChange={setClockOn} type="time" />
              <Field label="Clock Off Time" value={clockOff} onChange={setClockOff} type="time" />
              <Field label="Total Clock Time (auto)" value={clockTotal} readOnly />
              <Field label="Total Requested Hours" value={requestedHrs} onChange={setRequestedHrs} placeholder="e.g. 1.50" />
            </div>
            {clockOn && clockOff && clockTotal && (
              <div style={{ fontSize: 12, color: '#6ee7b7', marginTop: 8 }}>
                {clockOn} → {clockOff} = <strong>{clockTotal} hrs</strong> total clock time.
              </div>
            )}
          </div>

          {/* Tech Notes */}
          <div style={section}>
            <div style={sectionTitle}>🛠 Labor Operation Description (Tech Notes)</div>
            <textarea value={techNotes} onChange={e => setTechNotes(e.target.value)} rows={10}
              style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }}
              placeholder="Type the full labor operation description / tech notes here. The text automatically flows down the note boxes on the PDF, and the next box is signed “Service Manager Shawn Laughner.”" />
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
              Notes flow across the PDF note boxes ({NOTE_FIRST}–{NOTE_LAST}); after the last line of notes, the next box reads “{SERVICE_MANAGER}.”
            </div>
          </div>

          {/* Status */}
          {status && (
            <div style={{ marginBottom: 16, padding: '10px 16px', background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : status.startsWith('❌') ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.05)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : status.startsWith('❌') ? 'rgba(239,68,68,.3)' : 'rgba(255,255,255,.1)'}`, borderRadius: 8, color: status.startsWith('✅') ? '#4ade80' : status.startsWith('❌') ? '#f87171' : '#94a3b8', fontSize: 13, fontWeight: 700 }}>
              {status}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <button onClick={previewPdf}
              style={{ background: 'rgba(110,231,249,.18)', border: '1px solid rgba(110,231,249,.5)', color: '#6ee7f9', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
              🖨️ View / Print PDF
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ background: 'rgba(251,191,36,.2)', border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14, opacity: saving ? 0.6 : 1 }}>
              💾 {saving ? 'Uploading…' : 'Upload / Save'}
            </button>
          </div>

          {!getGithubToken() && (
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, padding: '8px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)' }}>
              ℹ️ <strong style={{ color: '#94a3b8' }}>View / Print works for everyone.</strong> To save worksheets to GitHub for other users to access, a manager must first set the GitHub token in Admin Settings on this device.
            </div>
          )}
        </div>
      </div>

      {/* Uploads Modal */}
      {showUploads && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowUploads(false)}>
          <div style={{ background: '#1e293b', border: '1px solid rgba(139,92,246,.4)', borderRadius: 18, width: '100%', maxWidth: 860, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.7)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,.08)', background: 'rgba(139,92,246,.08)', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#c4b5fd' }}>📂 Uploaded Worksheets</div>
                <div style={{ fontSize: 12, color: '#7c3aed', marginTop: 2 }}>Click View to open the PDF, or Download to save it</div>
              </div>
              <button onClick={() => setShowUploads(false)}
                style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', color: '#94a3b8', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                ✕ Close
              </button>
            </div>
            <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
              {loadingList ? (
                <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: 40 }}>⏳ Loading…</div>
              ) : savedList.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 14, textAlign: 'center', padding: 40 }}>No uploaded worksheets yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {savedList.map(s => (
                    <div key={s.id} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontWeight: 900, fontSize: 15, color: '#c4b5fd', marginBottom: 4 }}>RO# {s.ro || '—'}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>VIN: {s.vin || '—'}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>RO Date: {s.roDate || '—'} &nbsp;|&nbsp; By: {s.savedBy || '—'}</div>
                        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>Uploaded: {s.savedAt ? new Date(s.savedAt).toLocaleString() : '—'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                        <button onClick={() => handleViewSaved(s)} disabled={pdfLoading === s.id + '_view'}
                          style={{ background: 'rgba(139,92,246,.25)', border: '1px solid rgba(139,92,246,.5)', color: '#c4b5fd', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13, opacity: pdfLoading === s.id + '_view' ? 0.6 : 1 }}>
                          {pdfLoading === s.id + '_view' ? '⏳' : '🖨️'} {pdfLoading === s.id + '_view' ? 'Opening…' : 'View / Print'}
                        </button>
                        <button onClick={() => handleDownloadSaved(s)} disabled={pdfLoading === s.id + '_dl'}
                          style={{ background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.5)', color: '#6ee7f9', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13, opacity: pdfLoading === s.id + '_dl' ? 0.6 : 1 }}>
                          {pdfLoading === s.id + '_dl' ? '⏳' : '⬇️'} {pdfLoading === s.id + '_dl' ? 'Downloading…' : 'Download PDF'}
                        </button>
                        <button onClick={() => handleDeleteSaved(s)} disabled={deletingId === s.id}
                          style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.4)', color: '#f87171', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13, opacity: deletingId === s.id ? 0.5 : 1 }}>
                          {deletingId === s.id ? '⏳ Deleting…' : '🗑 Delete'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
