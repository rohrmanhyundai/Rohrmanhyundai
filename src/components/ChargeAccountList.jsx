import React, { useState, useRef } from 'react';

const STORAGE_KEY = 'chargeAccountListV1';
const UPLOAD_TS_KEY = 'chargeAccountUploadedAt';

// ── Persist helpers ────────────────────────────────────────────────────────────
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function persist(accounts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

// ── PDF.js – loaded from CDN on first use ─────────────────────────────────────
let pdfjsPromise = null;
function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js from CDN'));
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

// ── Extract text lines from PDF with positional grouping ─────────────────────
async function extractLines(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const allLines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group text items by rounded y-coordinate (same line = same y)
    const byY = {};
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!byY[y]) byY[y] = [];
      byY[y].push({ x: item.transform[4], text: item.str });
    }

    // Sort top-to-bottom, then left-to-right within each line
    Object.entries(byY)
      .sort(([a], [b]) => Number(b) - Number(a))
      .forEach(([, items]) => {
        items.sort((a, b) => a.x - b.x);
        const line = items.map(i => i.text).join(' ').trim();
        if (line) allLines.push(line);
      });
  }
  return allLines;
}

// ── Parse lines into account objects ─────────────────────────────────────────
// Format from this DMS PDF:
//   CUSTOMER NAME  CUSTOMER_ID  ZIP  (WHOLESALE|RETAIL|PARTS|CASH)  [YES NO YES YES ...]
// The YES/NO block may wrap to the next line.
// Column order after the sale type keyword:
//   [0] Charge Acct   [1] Tax Exempt On File   [2] Verified   [3] Add/Phone ...

// Matches the start of a customer record line
const RECORD_RE = /^([A-Z0-9][A-Z0-9\s&'.,''\-\/]*?)\s+(\d{4}[_\-]\d{4}|\d{5,8})\s+\d{5}\s+(?:WHOLESALE|RETAIL|PARTS|CASH|FLEET)/i;

function parseAccounts(lines) {
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(RECORD_RE);
    if (!match) continue;

    const name = match[1].trim().replace(/\s+/g, ' ');
    const customerId = match[2];

    // Text that comes after the matched portion on the same line
    let yesNoSource = line.slice(match[0].length).trim();

    // If no YES/NO on this line, peek at the next line (continuation)
    if (!/\b(YES|NO)\b/i.test(yesNoSource) && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (/^(YES|NO)\b/i.test(nextLine)) {
        yesNoSource = nextLine;
        i++; // consume the continuation line
      }
    }

    // Extract YES/NO tokens in order
    const yesNos = [];
    const ynRe = /\b(YES|NO)\b/gi;
    let m;
    while ((m = ynRe.exec(yesNoSource)) !== null) {
      yesNos.push(m[1].toUpperCase());
    }

    // Column mapping: [0] = Charge Acct, [1] = Tax Exempt On File
    const chargeAcct = yesNos[0] === 'YES' ? 'Yes' : 'No';
    const taxExempt  = yesNos[1] === 'YES' ? 'Yes' : (yesNos[1] === 'NO' ? 'No' : '—');

    results.push({ name, id: customerId, chargeAcct, taxExempt });
  }

  // Deduplicate by ID
  const seen = new Set();
  return results.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ChargeAccountList({ onBack }) {
  const [accounts, setAccounts]   = useState(loadSaved);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState('');
  const [copiedId, setCopiedId]   = useState(null);
  const [dragOver, setDragOver]   = useState(false);
  const [uploadedAt, setUploadedAt] = useState(() => localStorage.getItem(UPLOAD_TS_KEY) || '');
  const [rawLines, setRawLines]   = useState(null);   // null = hide, array = show
  const [error, setError]         = useState('');
  const [approvedOnly, setApprovedOnly] = useState(true); // filter to Charge Acct = Yes
  const fileRef = useRef();

  // ── Process uploaded file ──────────────────────────────────────────────────
  async function processFile(file) {
    if (!file?.name?.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file.'); return;
    }
    setError('');
    setLoading(true);
    setRawLines(null);
    try {
      const lines = await extractLines(file);
      const parsed = parseAccounts(lines);

      if (parsed.length === 0) {
        setRawLines(lines); // show raw so user can debug
        setError(`Auto-parse found 0 accounts from ${lines.length} lines. Raw text is shown below — use it to identify the format.`);
        setLoading(false);
        return;
      }

      setAccounts(parsed);
      persist(parsed);
      const ts = new Date().toLocaleString();
      setUploadedAt(ts);
      localStorage.setItem(UPLOAD_TS_KEY, ts);
    } catch (err) {
      setError('Error reading PDF: ' + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────
  function copyId(id) {
    navigator.clipboard?.writeText(id).catch(() => {
      const el = document.createElement('textarea');
      el.value = id;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
    setCopiedId(id);
    setTimeout(() => setCopiedId(c => c === id ? null : c), 1800);
  }

  // ── Clear ─────────────────────────────────────────────────────────────────
  function clearList() {
    if (!window.confirm('Remove all charge account data?')) return;
    setAccounts([]);
    setUploadedAt('');
    setRawLines(null);
    setError('');
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(UPLOAD_TS_KEY);
  }

  // ── Filtered list ─────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const base = approvedOnly ? accounts.filter(a => a.chargeAcct === 'Yes') : accounts;
  const filtered = q
    ? base.filter(a => a.name.toLowerCase().includes(q) || a.id.includes(q))
    : base;

  const approvedCount  = accounts.filter(a => a.chargeAcct === 'Yes').length;
  const exemptCount    = base.filter(a => a.taxExempt === 'Yes').length;
  const nonExemptCount = base.filter(a => a.taxExempt === 'No').length;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">Charge Account List</div>
          <div className="adv-sub">Approved Charge Accounts</div>
        </div>
        <div style={{ flex: 1 }} />
        {accounts.length > 0 && (
          <button
            onClick={clearList}
            style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#fca5a5', borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            🗑 Clear List
          </button>
        )}
        <button className="secondary" onClick={onBack}>← Parts Hub</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px 40px' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>

          {/* ── Stats + controls ── */}
          {accounts.length > 0 && (
            <div style={{ marginBottom: 24 }}>

              {/* Stats bar */}
              <div style={{
                display: 'flex', alignItems: 'stretch',
                background: 'rgba(255,255,255,.04)',
                border: '1px solid rgba(255,255,255,.09)',
                borderRadius: 14, overflow: 'hidden',
                marginBottom: 12,
              }}>
                {[
                  { label: 'Total in File', value: accounts.length, color: '#6ee7f9', dot: 'rgba(61,214,195,.7)' },
                  { label: 'Charge Accounts', value: approvedCount, color: '#a5b4fc', dot: 'rgba(99,102,241,.7)' },
                  { label: 'Tax Exempt', value: exemptCount, color: '#86efac', dot: 'rgba(134,239,172,.7)' },
                  { label: 'Not Exempt', value: nonExemptCount, color: '#fdba74', dot: 'rgba(251,146,60,.7)' },
                ].map((s, idx, arr) => (
                  <div
                    key={s.label}
                    style={{
                      flex: 1, padding: '16px 20px',
                      borderRight: idx < arr.length - 1 ? '1px solid rgba(255,255,255,.07)' : 'none',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>{s.label}</div>
                      <div style={{ fontSize: 24, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Controls row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => setApprovedOnly(v => !v)}
                  style={{
                    background: approvedOnly ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.05)',
                    border: `1px solid ${approvedOnly ? 'rgba(99,102,241,.45)' : 'rgba(255,255,255,.10)'}`,
                    borderRadius: 8, color: approvedOnly ? '#a5b4fc' : '#475569',
                    padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    whiteSpace: 'nowrap', transition: 'all .15s', flexShrink: 0,
                  }}
                >
                  {approvedOnly ? '✓ Approved Only' : '· Show All'}
                </button>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    placeholder="Search by name or customer ID…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{
                      width: '100%', background: 'rgba(255,255,255,.05)',
                      border: '1px solid rgba(255,255,255,.10)', borderRadius: 8,
                      color: '#e2e8f0', fontSize: 14, padding: '8px 14px',
                      fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

            </div>
          )}

          {/* ── Table ── */}
          {accounts.length > 0 && (
            <>
              <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,.06)', borderBottom: '2px solid rgba(255,255,255,.08)' }}>
                      <th style={TH}>#</th>
                      <th style={{ ...TH, textAlign: 'left' }}>Customer Name</th>
                      <th style={{ ...TH, textAlign: 'left' }}>Customer ID</th>
                      <th style={{ ...TH, textAlign: 'center' }}>Charge Acct</th>
                      <th style={{ ...TH, textAlign: 'center' }}>Tax Exempt on File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#475569' }}>
                          No accounts match your search.
                        </td>
                      </tr>
                    ) : filtered.map((a, i) => (
                      <tr
                        key={a.id + i}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,.05)',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.018)',
                        }}
                      >
                        {/* Row number */}
                        <td style={{ padding: '10px 14px', color: '#334155', fontSize: 12, width: 48 }}>{i + 1}</td>

                        {/* Customer Name */}
                        <td style={{ padding: '10px 14px', color: '#e2e8f0', fontWeight: 600 }}>{a.name}</td>

                        {/* Customer ID — click to copy */}
                        <td style={{ padding: '10px 14px' }}>
                          <button
                            onClick={() => copyId(a.id)}
                            title="Click to copy Customer ID"
                            style={{
                              background: copiedId === a.id ? 'rgba(134,239,172,.18)' : 'rgba(110,231,249,.1)',
                              border: `1px solid ${copiedId === a.id ? 'rgba(134,239,172,.45)' : 'rgba(110,231,249,.28)'}`,
                              borderRadius: 6,
                              color: copiedId === a.id ? '#86efac' : '#6ee7f9',
                              fontFamily: 'monospace', fontSize: 13, fontWeight: 700,
                              padding: '3px 11px', cursor: 'pointer',
                              transition: 'all .15s', letterSpacing: .5,
                            }}
                          >
                            {copiedId === a.id ? '✓ Copied!' : a.id}
                          </button>
                        </td>

                        {/* Charge Acct */}
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', padding: '3px 14px', borderRadius: 20,
                            fontSize: 12, fontWeight: 700,
                            background: a.chargeAcct === 'Yes' ? 'rgba(99,102,241,.15)' : 'rgba(100,116,139,.1)',
                            border: `1px solid ${a.chargeAcct === 'Yes' ? 'rgba(99,102,241,.4)' : 'rgba(100,116,139,.25)'}`,
                            color: a.chargeAcct === 'Yes' ? '#a5b4fc' : '#64748b',
                          }}>
                            {a.chargeAcct === 'Yes' ? '✓ Yes' : '✗ No'}
                          </span>
                        </td>

                        {/* Tax Exempt */}
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', padding: '3px 14px', borderRadius: 20,
                            fontSize: 12, fontWeight: 700,
                            background: a.taxExempt === 'Yes' ? 'rgba(134,239,172,.14)' : 'rgba(251,146,60,.14)',
                            border: `1px solid ${a.taxExempt === 'Yes' ? 'rgba(134,239,172,.38)' : 'rgba(251,146,60,.38)'}`,
                            color: a.taxExempt === 'Yes' ? '#86efac' : '#fdba74',
                          }}>
                            {a.taxExempt === 'Yes' ? '✓ Yes' : a.taxExempt === 'No' ? '✗ No' : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {q && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#475569', textAlign: 'right' }}>
                  Showing {filtered.length} of {accounts.length} accounts
                </div>
              )}
            </>
          )}

          {/* Empty state */}
          {accounts.length === 0 && !loading && !error && (
            <div style={{ textAlign: 'center', padding: '64px 0', color: '#475569' }}>
              <div style={{ fontSize: 52, marginBottom: 14 }}>📋</div>
              <div style={{ fontSize: 16, color: '#64748b', marginBottom: 6 }}>No charge accounts loaded yet</div>
              <div style={{ fontSize: 13, color: '#334155' }}>Upload your charge account PDF below to populate the list</div>
            </div>
          )}

          {/* ── Upload zone (bottom) ── */}
          <div style={{ marginTop: 32 }}>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'rgba(61,214,195,.75)' : 'rgba(255,255,255,.10)'}`,
                borderRadius: 12, padding: '18px 24px', textAlign: 'center',
                cursor: loading ? 'default' : 'pointer',
                background: dragOver ? 'rgba(61,214,195,.06)' : 'transparent',
                transition: 'all .2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
              }}
            >
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
                onChange={e => { if (e.target.files[0]) processFile(e.target.files[0]); e.target.value = ''; }} />
              {loading ? (
                <div style={{ color: '#6ee7f9', fontSize: 14 }}>⏳ Reading PDF and parsing accounts…</div>
              ) : (
                <>
                  <span style={{ fontSize: 22 }}>📄</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, color: '#64748b', fontSize: 13 }}>
                      {accounts.length > 0 ? 'Re-upload Charge Account PDF' : 'Upload Charge Account PDF'}
                    </div>
                    <div style={{ color: '#334155', fontSize: 12 }}>
                      Drag & drop or click · PDF only
                      {uploadedAt && <span style={{ marginLeft: 10 }}>· Last uploaded: {uploadedAt}</span>}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Error / debug banner */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '12px 18px', marginTop: 12, color: '#fca5a5', fontSize: 13 }}>
                ⚠ {error}
              </div>
            )}

            {/* Raw text debug */}
            {rawLines && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 700, color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
                  Raw extracted lines from PDF ({rawLines.length}):
                </div>
                <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 16, maxHeight: 320, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                  {rawLines.map((l, i) => `${String(i + 1).padStart(4, ' ')}  ${l}`).join('\n')}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

const TH = {
  padding: '11px 14px',
  fontWeight: 700,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '.07em',
  textAlign: 'left',
};
