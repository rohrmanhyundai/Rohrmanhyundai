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
const SKIP = [
  /charge\s+account/i, /as\s+of\s+\d/i, /credit\s+limit/i, /print\s+date/i,
  /page\s+\d/i, /^total/i, /listing/i, /report/i, /^cust\b/i, /^acct\b/i,
  /^account\b/i, /^customer\s+name/i, /^name\b/i, /dealer/i, /date:/i,
  /^\s*[-=]+\s*$/, /company:/i, /balance/i, /^#\s/i, /^id\s/i,
];

const TAX_YES = /\b(y(?:es)?|tax.?exempt)\b/i;
const TAX_NO  = /\b(n(?:o)?|non.?exempt)\b/i;

function detectTax(s) {
  if (TAX_YES.test(s)) return 'Yes';
  if (TAX_NO.test(s))  return 'No';
  return null;
}

function parseAccounts(lines) {
  const results = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length < 4) continue;
    if (SKIP.some(r => r.test(line))) continue;

    // ── Strategy 1: ID  NAME  TAX (ID leads, whitespace-separated)
    let m = line.match(/^(\d{2,10})\s{1,}(.{2,50}?)\s{2,}(Y(?:es)?|N(?:o)?|TAX.?EXEMPT|NON.?EXEMPT)\s*$/i);
    if (m) {
      results.push({ id: m[1], name: m[2].replace(/\s+/g, ' ').trim(), taxExempt: detectTax(m[3]) || 'No' });
      continue;
    }

    // ── Strategy 2: NAME  ID  TAX (name leads)
    m = line.match(/^(.{3,50}?)\s{2,}(\d{2,10})\s{2,}(Y(?:es)?|N(?:o)?|TAX.?EXEMPT|NON.?EXEMPT)\s*$/i);
    if (m) {
      results.push({ id: m[2], name: m[1].replace(/\s+/g, ' ').trim(), taxExempt: detectTax(m[3]) || 'No' });
      continue;
    }

    // ── Strategy 3: ID  NAME  (no explicit tax field)
    m = line.match(/^(\d{3,10})\s{2,}([A-Z].{2,48}?)\s*$/);
    if (m && !/^\d/.test(m[2])) {
      results.push({ id: m[1], name: m[2].replace(/\s+/g, ' ').trim(), taxExempt: 'No' });
      continue;
    }

    // ── Strategy 4: NAME  ID  (name leads, no tax)
    m = line.match(/^([A-Z].{2,48}?)\s{2,}(\d{4,10})\s*$/);
    if (m) {
      results.push({ id: m[2], name: m[1].replace(/\s+/g, ' ').trim(), taxExempt: 'No' });
    }
  }

  // Deduplicate by id
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
  const filtered = q
    ? accounts.filter(a => a.name.toLowerCase().includes(q) || a.id.includes(q))
    : accounts;

  const exemptCount    = accounts.filter(a => a.taxExempt === 'Yes').length;
  const nonExemptCount = accounts.length - exemptCount;

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

          {/* ── Upload zone ── */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'rgba(61,214,195,.75)' : 'rgba(255,255,255,.14)'}`,
              borderRadius: 14, padding: '26px 32px', textAlign: 'center',
              cursor: loading ? 'default' : 'pointer',
              background: dragOver ? 'rgba(61,214,195,.06)' : 'rgba(255,255,255,.025)',
              marginBottom: 24, transition: 'all .2s',
            }}
          >
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => { if (e.target.files[0]) processFile(e.target.files[0]); e.target.value = ''; }} />
            {loading ? (
              <div style={{ color: '#6ee7f9', fontSize: 15 }}>⏳ Reading PDF and parsing accounts…</div>
            ) : (
              <>
                <div style={{ fontSize: 34, marginBottom: 8 }}>📄</div>
                <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15, marginBottom: 4 }}>
                  {accounts.length > 0 ? 'Re-upload Charge Account PDF' : 'Upload Charge Account PDF'}
                </div>
                <div style={{ color: '#475569', fontSize: 13 }}>Drag & drop or click to select · PDF files only</div>
                {uploadedAt && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#334155' }}>Last uploaded: {uploadedAt}</div>
                )}
              </>
            )}
          </div>

          {/* Error / debug banner */}
          {error && (
            <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '12px 18px', marginBottom: 20, color: '#fca5a5', fontSize: 13 }}>
              ⚠ {error}
            </div>
          )}

          {/* Raw text debug (shown only when parse fails) */}
          {rawLines && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 700, color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
                Raw extracted lines from PDF ({rawLines.length}):
              </div>
              <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 16, maxHeight: 320, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                {rawLines.map((l, i) => `${String(i + 1).padStart(4, ' ')}  ${l}`).join('\n')}
              </div>
            </div>
          )}

          {/* ── Stats + search ── */}
          {accounts.length > 0 && (
            <div style={{ display: 'flex', gap: 14, marginBottom: 22, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ background: 'rgba(61,214,195,.1)', border: '1px solid rgba(61,214,195,.25)', borderRadius: 10, padding: '10px 18px', minWidth: 110 }}>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em' }}>Total</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#6ee7f9', lineHeight: 1.1 }}>{accounts.length}</div>
              </div>
              <div style={{ background: 'rgba(134,239,172,.1)', border: '1px solid rgba(134,239,172,.25)', borderRadius: 10, padding: '10px 18px', minWidth: 110 }}>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em' }}>Tax Exempt</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#86efac', lineHeight: 1.1 }}>{exemptCount}</div>
              </div>
              <div style={{ background: 'rgba(251,146,60,.1)', border: '1px solid rgba(251,146,60,.25)', borderRadius: 10, padding: '10px 18px', minWidth: 110 }}>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em' }}>Not Exempt</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#fdba74', lineHeight: 1.1 }}>{nonExemptCount}</div>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <input
                  type="text"
                  placeholder="🔍  Search by name or customer ID…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,.06)',
                    border: '1px solid rgba(255,255,255,.12)', borderRadius: 8,
                    color: '#e2e8f0', fontSize: 14, padding: '10px 14px',
                    fontFamily: 'inherit', boxSizing: 'border-box',
                  }}
                />
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
                      <th style={{ ...TH, textAlign: 'center' }}>Tax Exempt on File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: '32px', textAlign: 'center', color: '#475569' }}>
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

                        {/* Tax Exempt */}
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', padding: '3px 14px', borderRadius: 20,
                            fontSize: 12, fontWeight: 700,
                            background: a.taxExempt === 'Yes' ? 'rgba(134,239,172,.14)' : 'rgba(251,146,60,.14)',
                            border: `1px solid ${a.taxExempt === 'Yes' ? 'rgba(134,239,172,.38)' : 'rgba(251,146,60,.38)'}`,
                            color: a.taxExempt === 'Yes' ? '#86efac' : '#fdba74',
                          }}>
                            {a.taxExempt === 'Yes' ? '✓ Yes' : '✗ No'}
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
              <div style={{ fontSize: 13, color: '#334155' }}>Upload your charge account PDF above to populate the list</div>
            </div>
          )}

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
