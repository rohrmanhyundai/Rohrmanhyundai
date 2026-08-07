import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { updateCashDash } from '../utils/github';

// Columns we read from the full-month tech hours report.
const FIELDS = [
  { key: 'tech',  label: 'Technician',   required: true, hints: ['technician', 'tech name', 'tech', 'employee', 'name', 'flat rate tech'] },
  { key: 'hours', label: 'Booked Hours', required: true, hints: ['booked hours', 'booked hrs', 'booked', 'flat rate hours', 'flat rate hrs', 'flagged hours', 'flag hours', 'fr hours', 'sold hours', 'actual hours', 'hours', 'hrs'] },
];

const norm = (v) => String(v ?? '').trim().toLowerCase();
const upper = (v) => String(v ?? '').trim().toUpperCase();
const firstName = (s) => upper(s).split(/\s+/)[0] || '';
const toNum = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] || []).map(norm);
    const hasName = cells.some(c => c.includes('tech') || c === 'name' || c.includes('employee'));
    const hasHours = cells.some(c => c.includes('hour') || c.includes('hrs') || c.includes('booked') || c.includes('flat rate'));
    if (hasName && hasHours) return i;
  }
  return -1;
}
function autoMap(headers) {
  const map = {};
  FIELDS.forEach(f => {
    let idx = headers.findIndex(h => f.hints.includes(norm(h)));
    if (idx === -1) idx = headers.findIndex(h => f.hints.some(hint => norm(h).includes(hint)));
    map[f.key] = idx;
  });
  return map;
}

// Match a report name to a technician: token overlap on first OR last name so
// "Jacob Kuntz", "Kuntz, Jacob" and "JACOB" all resolve to the same tech.
function matchTech(reportName, techs) {
  const rt = new Set(upper(reportName).split(/[\s,]+/).filter(Boolean));
  if (rt.size === 0) return null;
  for (const t of techs) {
    const tt = upper(t.name).split(/[\s,]+/).filter(Boolean);
    if (tt.some(tok => rt.has(tok))) return t;
  }
  return null;
}

export default function CashDashUpload({ technicians = [], monthKey, monthLabel, currentUser, onApplied }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState('');
  const [open, setOpen] = useState(false);

  async function handleFile(file) {
    if (!file) return;
    setError(''); setApplied(''); setBusy(true); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (!rows || rows.length === 0) throw new Error('The file appears to be empty.');
      const hi = findHeaderRow(rows);
      const headerIdx = hi === -1 ? 0 : hi;
      const hdr = (rows[headerIdx] || []).map(h => String(h ?? '').trim());
      const body = rows.slice(headerIdx + 1).filter(r => (r || []).some(c => String(c ?? '').trim() !== ''));
      setHeaders(hdr); setDataRows(body); setMapping(autoMap(hdr));
    } catch (e) {
      setError(e.message || 'Could not read the file.');
      setHeaders([]); setDataRows([]); setMapping({});
    } finally { setBusy(false); }
  }

  // Report rows → { name, hours }, skipping total/summary rows and blanks.
  const parsed = useMemo(() => {
    if ((mapping.tech ?? -1) < 0 || (mapping.hours ?? -1) < 0) return [];
    const out = [];
    for (const r of dataRows) {
      const name = String(r[mapping.tech] ?? '').trim();
      if (!name || /^(total|grand|average|avg|summary|department)/i.test(name)) continue;
      const hours = toNum(r[mapping.hours]);
      if (hours == null) continue;
      out.push({ name, hours: round1(hours) });
    }
    return out;
  }, [dataRows, mapping]);

  // Match parsed rows to the roster. Each tech gets the last matching row.
  const { matched, unmatchedRows, missingTechs } = useMemo(() => {
    const techs = (technicians || []).filter(t => t && t.name);
    const byTech = new Map(); // firstNameKey -> { tech, hours, reportName }
    const unmatched = [];
    for (const row of parsed) {
      const t = matchTech(row.name, techs);
      if (t) byTech.set(firstName(t.name), { tech: t, hours: row.hours, reportName: row.name });
      else unmatched.push(row);
    }
    const matchedList = techs
      .map(t => byTech.get(firstName(t.name)))
      .filter(Boolean)
      .sort((a, b) => a.tech.name.localeCompare(b.tech.name));
    const missing = techs
      .filter(t => !byTech.has(firstName(t.name)))
      .map(t => t.name)
      .sort();
    return { matched: matchedList, unmatchedRows: unmatched, missingTechs: missing };
  }, [parsed, technicians]);

  async function apply() {
    if (matched.length === 0) return;
    if (!window.confirm(`Set ${monthLabel} booked hours for ${matched.length} technician${matched.length === 1 ? '' : 's'} from this report? This overwrites their current Cash Dash hours.`)) return;
    setBusy(true); setError(''); setApplied('');
    try {
      await updateCashDash(cur => {
        const bucket = { techHours: {}, ...(cur[monthKey] || {}) };
        const th = { ...(bucket.techHours || {}) };
        matched.forEach(m => { th[firstName(m.tech.name)] = m.hours; });
        bucket.techHours = th;
        bucket.updatedAt = Date.now();
        bucket.techHoursBy = currentUser || '';
        return { ...cur, [monthKey]: bucket };
      });
      setApplied(`✅ Updated ${matched.length} technician${matched.length === 1 ? '' : 's'} for ${monthLabel}.`);
      onApplied && onApplied();
    } catch (e) {
      setError(e.message || 'Could not save. Try again.');
    } finally { setBusy(false); }
  }

  function reset() {
    setFileName(''); setHeaders([]); setDataRows([]); setMapping({}); setError(''); setApplied('');
    if (fileRef.current) fileRef.current.value = '';
  }

  const ready = headers.length > 0 && (mapping.tech ?? -1) >= 0 && (mapping.hours ?? -1) >= 0;
  const sel = { background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, color: '#e2e8f0', padding: '6px 10px', fontSize: 13, outline: 'none', width: '100%' };
  const th = { textAlign: 'left', padding: '7px 12px', color: '#64748b', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.18)' };
  const td = { padding: '7px 12px', color: '#cbd5e1', borderBottom: '1px solid rgba(148,163,184,.07)', fontSize: 13 };

  return (
    <section style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(52,211,153,.3)', borderRadius: 16, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: '#6ee7b7' }}>📥 Upload Full-Month Tech Hours</div>
        <div style={{ fontSize: 12, color: '#94a3b8', flex: 1, minWidth: 180 }}>
          Same report as tech-hours reporting, full month for <strong style={{ color: '#e2e8f0' }}>{monthLabel}</strong>. Overwrites every tech’s Cash Dash hours.
        </div>
        <button onClick={() => setOpen(o => !o)}
          style={{ background: 'rgba(52,211,153,.18)', border: '1px solid rgba(52,211,153,.5)', color: '#6ee7b7', borderRadius: 9, padding: '7px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
          {open ? 'Hide' : 'Upload report'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <div onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
            style={{ border: '2px dashed rgba(52,211,153,.4)', borderRadius: 14, padding: '22px 18px', textAlign: 'center', cursor: 'pointer', background: 'rgba(52,211,153,.05)' }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>📄</div>
            <div style={{ fontWeight: 800, color: '#6ee7b7', fontSize: 14 }}>{fileName || 'Click to choose an .xlsx file (or drag it here)'}</div>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>Full-month technician hours report. One booked-hours total per tech.</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
          </div>

          {busy && <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>⏳ Working…</div>}
          {error && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 12, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '9px 13px' }}>{error}</div>}
          {applied && <div style={{ color: '#6ee7b7', fontSize: 13, marginTop: 12, background: 'rgba(52,211,153,.1)', border: '1px solid rgba(52,211,153,.35)', borderRadius: 10, padding: '9px 13px' }}>{applied}</div>}

          {headers.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14, alignItems: 'flex-end' }}>
                {FIELDS.map(f => (
                  <div key={f.key} style={{ flex: '1 1 200px' }}>
                    <label style={{ fontSize: 10.5, fontWeight: 800, color: '#6ee7b7', textTransform: 'uppercase', letterSpacing: '.04em' }}>{f.label} *</label>
                    <select value={mapping[f.key] ?? -1} onChange={e => setMapping(m => ({ ...m, [f.key]: parseInt(e.target.value, 10) }))} style={{ ...sel, marginTop: 4 }}>
                      <option value={-1}>— not mapped —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </div>
                ))}
                <button className="secondary" onClick={reset} style={{ height: 34 }}>↺ Start over</button>
              </div>

              {!ready && <div style={{ color: '#fbbf24', fontSize: 12.5, marginTop: 12 }}>Map both <strong>Technician</strong> and <strong>Booked Hours</strong> to continue.</div>}

              {ready && (
                <>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '14px 0' }}>
                    <Chip color="#6ee7b7" label="Techs matched" value={matched.length} />
                    <Chip color="#fbbf24" label="Techs not in report" value={missingTechs.length} />
                    <Chip color="#fca5a5" label="Rows not matched" value={unmatchedRows.length} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                    <button onClick={apply} disabled={busy || matched.length === 0}
                      style={{ background: matched.length ? 'rgba(52,211,153,.22)' : 'rgba(255,255,255,.05)', border: `1px solid ${matched.length ? 'rgba(52,211,153,.55)' : 'rgba(255,255,255,.1)'}`, color: matched.length ? '#6ee7b7' : '#475569', borderRadius: 10, padding: '9px 20px', fontWeight: 800, fontSize: 13.5, cursor: matched.length ? 'pointer' : 'default' }}>
                      {busy ? '⏳ Saving…' : `💾 Apply to ${matched.length} tech${matched.length === 1 ? '' : 's'}`}
                    </button>
                  </div>

                  <div style={{ overflow: 'auto', border: '1px solid rgba(148,163,184,.14)', borderRadius: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr style={{ background: 'rgba(2,6,23,.4)' }}>
                        <th style={th}>Technician</th><th style={th}>Report name</th><th style={{ ...th, textAlign: 'right' }}>New booked hours</th>
                      </tr></thead>
                      <tbody>
                        {matched.map((m, i) => (
                          <tr key={i}>
                            <td style={{ ...td, fontWeight: 800, color: '#e2e8f0' }}>{m.tech.name}</td>
                            <td style={{ ...td, color: '#94a3b8' }}>{m.reportName}</td>
                            <td style={{ ...td, textAlign: 'right', fontWeight: 900, color: '#6ee7b7' }}>{round1(m.hours)}</td>
                          </tr>
                        ))}
                        {matched.length === 0 && <tr><td style={{ ...td, color: '#64748b' }} colSpan={3}>No technicians matched — check the column mapping and the report’s tech names.</td></tr>}
                      </tbody>
                    </table>
                  </div>

                  {missingTechs.length > 0 && (
                    <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 10 }}>
                      <strong>Not in the report (left unchanged):</strong> {missingTechs.join(', ')}
                    </div>
                  )}
                  {unmatchedRows.length > 0 && (
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                      <strong style={{ color: '#fca5a5' }}>Report rows with no matching tech:</strong> {unmatchedRows.map(r => `${r.name} (${round1(r.hours)})`).join(', ')}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Chip({ color, label, value }) {
  return (
    <div style={{ background: 'rgba(15,23,42,.55)', border: `1px solid ${color}55`, borderRadius: 10, padding: '8px 14px', minWidth: 120 }}>
      <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>{value}</div>
    </div>
  );
}
