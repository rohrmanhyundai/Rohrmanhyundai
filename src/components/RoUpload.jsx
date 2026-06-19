import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { loadAwaitingData, saveAwaitingData } from '../utils/github';

// Fields we can map a spreadsheet column onto. RO Number is the only required one.
const FIELDS = [
  { key: 'ro',        label: 'RO Number',   required: true,  hints: ['ro', 'repair order', 'ro #', 'ro number', 'order #', 'order number'] },
  { key: 'advisor',   label: 'Advisor',     required: false, hints: ['advisor', 'service advisor', 'writer', 'sa'] },
  { key: 'tech',      label: 'Technician',  required: false, hints: ['tech', 'technician'] },
  { key: 'customer',  label: 'Customer',    required: false, hints: ['customer', 'cust name', 'name', 'last name'] },
  { key: 'jobDesc',   label: 'Job / Complaint', required: false, hints: ['complaint', 'job', 'description', 'concern', 'op code', 'opcode', 'service'] },
  { key: 'roDate',    label: 'RO Date',     required: false, hints: ['date', 'open date', 'ro date', 'opened'] },
];

const norm = (v) => String(v ?? '').trim().toLowerCase();

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Heuristically find the header row: the first row (within the first 25) that
// contains something that looks like an RO column.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] || []).map(norm);
    const hasRo = cells.some(c => c === 'ro' || c.includes('repair order') || c.includes('ro #') || c.includes('ro number') || /\bro\b/.test(c));
    if (hasRo && cells.filter(Boolean).length >= 2) return i;
  }
  return -1;
}

// Best-guess a column index for each field from the header labels.
function autoMap(headers) {
  const map = {};
  FIELDS.forEach(f => {
    let idx = headers.findIndex(h => f.hints.includes(norm(h)));
    if (idx === -1) idx = headers.findIndex(h => f.hints.some(hint => norm(h).includes(hint)));
    map[f.key] = idx; // -1 = unmapped
  });
  return map;
}

export default function RoUpload({ onBack, currentUser }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]); // array of arrays
  const [mapping, setMapping] = useState({});   // field key -> column index
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  async function handleFile(file) {
    if (!file) return;
    setError(''); setImportStatus(''); setBusy(true);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (!rows || rows.length === 0) throw new Error('The file appears to be empty.');

      const headerIdx = findHeaderRow(rows);
      if (headerIdx === -1) throw new Error('Could not find a header row with an "RO" / "Repair Order" column. Open the file and confirm it has column headings.');

      const hdr = (rows[headerIdx] || []).map(h => String(h ?? '').trim());
      const body = rows.slice(headerIdx + 1).filter(r => (r || []).some(c => String(c ?? '').trim() !== ''));

      setHeaders(hdr);
      setDataRows(body);
      setMapping(autoMap(hdr));
    } catch (e) {
      setError(e.message || 'Could not read the file.');
      setHeaders([]); setDataRows([]); setMapping({});
    } finally {
      setBusy(false);
    }
  }

  // Build the parsed RO objects from the current mapping.
  const parsed = useMemo(() => {
    if (mapping.ro == null || mapping.ro < 0) return [];
    return dataRows.map(r => {
      const val = (key) => {
        const idx = mapping[key];
        return (idx != null && idx >= 0) ? String(r[idx] ?? '').trim() : '';
      };
      return {
        ro: val('ro'), advisor: val('advisor'), tech: val('tech'),
        customer: val('customer'), jobDesc: val('jobDesc'), roDate: val('roDate'),
      };
    }).filter(o => o.ro);
  }, [dataRows, mapping]);

  function reset() {
    setFileName(''); setHeaders([]); setDataRows([]); setMapping({}); setError(''); setImportStatus('');
    if (fileRef.current) fileRef.current.value = '';
  }

  // v1 import target: Cars Awaiting (unassigned open ROs). We'll refine the
  // destination/mapping together once the real report format is dialed in.
  async function importToAwaiting() {
    if (parsed.length === 0) return;
    if (!window.confirm(`Add ${parsed.length} repair order${parsed.length === 1 ? '' : 's'} to Cars Awaiting Technician?\n\nExisting ROs already in the list will be skipped.`)) return;
    setBusy(true); setImportStatus('Importing…'); setError('');
    try {
      const existing = await loadAwaitingData();
      const have = new Set((existing || []).map(r => norm(r.ro)).filter(Boolean));
      let added = 0;
      const toAdd = [];
      for (const o of parsed) {
        if (have.has(norm(o.ro))) continue;
        have.add(norm(o.ro));
        toAdd.push({
          id: genId(), ro: o.ro, roDate: o.roDate || todayISO(),
          jobDesc: o.jobDesc || '', highPriority: false,
          advisor: o.advisor || '', notes: o.customer ? `Customer: ${o.customer}` : '',
          partsArrived: null, partsArrivedDate: '', isNew: true,
        });
        added++;
      }
      if (added === 0) { setImportStatus('Nothing new to add — all ROs already exist in Cars Awaiting.'); setBusy(false); return; }
      await saveAwaitingData([...(existing || []), ...toAdd]);
      setImportStatus(`✅ Added ${added} repair order${added === 1 ? '' : 's'} to Cars Awaiting${added !== parsed.length ? ` (${parsed.length - added} skipped as duplicates)` : ''}.`);
    } catch (e) {
      setError(e.message || 'Import failed.');
      setImportStatus('');
    } finally {
      setBusy(false);
    }
  }

  const inpSel = {
    background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.3)',
    borderRadius: 8, color: '#e2e8f0', padding: '6px 10px', fontSize: 13, outline: 'none', width: '100%',
  };

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">📤 RO Upload</div>
          <div className="adv-sub">Bulk-add repair orders from an open-RO report · managers only</div>
        </div>
        <div style={{ flex: 1 }} />
        {(headers.length > 0 || fileName) && <button className="secondary" onClick={reset} style={{ marginRight: 10 }}>↺ Start Over</button>}
        <button className="secondary" onClick={onBack}>← Advisor Calendar</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px 40px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>

          {/* Upload box */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
            style={{
              border: '2px dashed rgba(52,211,153,.4)', borderRadius: 16, padding: '36px 24px',
              textAlign: 'center', cursor: 'pointer', background: 'rgba(52,211,153,.05)', marginBottom: 24,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 800, color: '#6ee7b7', fontSize: 16 }}>
              {fileName ? fileName : 'Click to choose an .xlsx file (or drag it here)'}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
              Upload your dealership's Open Repair Order report. We'll read the first sheet.
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files?.[0])} />
          </div>

          {busy && <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>⏳ Working…</div>}
          {error && <div style={{ color: '#fca5a5', fontSize: 14, marginBottom: 16, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px' }}>{error}</div>}
          {importStatus && <div style={{ color: importStatus.startsWith('✅') ? '#6ee7b7' : '#fbbf24', fontSize: 14, marginBottom: 16, background: 'rgba(255,255,255,.04)', borderRadius: 10, padding: '10px 14px' }}>{importStatus}</div>}

          {headers.length > 0 && (
            <>
              {/* Column mapping */}
              <div style={{ background: 'rgba(15,23,42,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 14, padding: 20, marginBottom: 24 }}>
                <div style={{ fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>Match the columns</div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>We guessed these from your headers — adjust any that are wrong. RO Number is required.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
                  {FIELDS.map(f => (
                    <div key={f.key}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: f.required ? '#6ee7b7' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        {f.label}{f.required ? ' *' : ''}
                      </label>
                      <select
                        value={mapping[f.key] ?? -1}
                        onChange={e => setMapping(m => ({ ...m, [f.key]: parseInt(e.target.value, 10) }))}
                        style={{ ...inpSel, marginTop: 4 }}
                      >
                        <option value={-1}>— not mapped —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ fontWeight: 800, color: '#e2e8f0' }}>
                  {parsed.length} repair order{parsed.length === 1 ? '' : 's'} detected
                  <span style={{ color: '#64748b', fontWeight: 500, fontSize: 13 }}> · from {dataRows.length} rows</span>
                </div>
                <button
                  onClick={importToAwaiting}
                  disabled={busy || parsed.length === 0}
                  style={{
                    background: parsed.length ? 'rgba(52,211,153,.2)' : 'rgba(255,255,255,.05)',
                    border: `1px solid ${parsed.length ? 'rgba(52,211,153,.5)' : 'rgba(255,255,255,.1)'}`,
                    color: parsed.length ? '#6ee7b7' : '#475569', borderRadius: 10, padding: '9px 18px',
                    fontWeight: 800, fontSize: 13, cursor: parsed.length ? 'pointer' : 'default',
                  }}
                >➕ Add to Cars Awaiting</button>
              </div>

              <div style={{ background: 'rgba(15,23,42,.4)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, overflow: 'auto', maxHeight: 460 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                      {FIELDS.filter(f => (mapping[f.key] ?? -1) >= 0).map(f => (
                        <th key={f.key} style={{ textAlign: 'left', padding: '10px 14px', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.2)' }}>{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, 200).map((o, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(148,163,184,.07)' }}>
                        {FIELDS.filter(f => (mapping[f.key] ?? -1) >= 0).map(f => (
                          <td key={f.key} style={{ padding: '7px 14px', color: f.key === 'ro' ? '#6ee7f9' : '#cbd5e1', fontFamily: f.key === 'ro' ? 'monospace' : 'inherit' }}>{o[f.key] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.length > 200 && <div style={{ padding: '10px 14px', color: '#64748b', fontSize: 12 }}>Showing first 200 of {parsed.length}.</div>}
              </div>

              <div style={{ fontSize: 12, color: '#475569', marginTop: 16 }}>
                v1 adds detected ROs to <strong>Cars Awaiting Technician</strong> (duplicates skipped). We'll refine column matching and the destination together once we run a real report through it.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
