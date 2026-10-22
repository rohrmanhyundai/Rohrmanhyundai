import React, { useState, useRef, useEffect } from 'react';
import * as github from '../utils/github';

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
// 📋 List: everyone with the page. ⚙️ Setup (admin / managers only): update
// from the DMS PDF — every change is shown before it's saved — and edit any
// account by hand.
export default function ChargeAccountList({ onBack, backLabel = '← Parts Hub', currentRole = '', initialTab, io }) {
  const { loadChargeAccounts, saveChargeAccounts } = io || github;
  const isManager = currentRole === 'admin' || /manager/i.test(currentRole || '');
  const [tab, setTab]             = useState(isManager && initialTab === 'setup' ? 'setup' : 'list');
  const [accounts, setAccounts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [copiedId, setCopiedId]   = useState(null);
  const [uploadedAt, setUploadedAt] = useState('');
  const [approvedOnly, setApprovedOnly] = useState(true); // filter to Charge Acct = Yes

  useEffect(() => {
    loadChargeAccounts()
      .then(data => {
        if (data && Array.isArray(data.accounts)) {
          setAccounts(data.accounts);
          setUploadedAt(data.uploadedAt || '');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>
      {isManager && (
        <div style={{ display: 'flex', gap: 8, padding: '12px 40px 0', flexShrink: 0 }}>
          {[['list', '📋 List'], ['setup', '⚙️ Setup']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ background: tab === k ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.04)', border: `1px solid ${tab === k ? 'rgba(110,231,249,.5)' : 'rgba(255,255,255,.1)'}`, color: tab === k ? '#6ee7f9' : '#94a3b8', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px 40px' }}>
        {isManager && tab === 'setup' ? (
          <ChargeSetup accounts={accounts} uploadedAt={uploadedAt} save={saveChargeAccounts}
            onSaved={(list, at) => { setAccounts(list); setUploadedAt(at); }} />
        ) : (
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
                {/* tableLayout auto (App.css forces `fixed` globally) so the
                    Customer Name column can size to its content instead of being
                    clipped to an equal share. */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, tableLayout: 'auto' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,.06)', borderBottom: '2px solid rgba(255,255,255,.08)' }}>
                      <th style={TH}>#</th>
                      <th style={{ ...TH, textAlign: 'left', whiteSpace: 'nowrap' }}>Customer Name</th>
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

                        {/* Customer Name — override the global td ellipsis clip
                            (App.css) so the full name always shows, wrapping if long. */}
                        <td style={{ padding: '10px 14px', color: '#e2e8f0', fontWeight: 600, whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', wordBreak: 'break-word', minWidth: 240 }}>{a.name}</td>

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
          {accounts.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '64px 0', color: '#475569' }}>
              <div style={{ fontSize: 52, marginBottom: 14 }}>📋</div>
              <div style={{ fontSize: 16, color: '#64748b', marginBottom: 6 }}>No charge accounts loaded yet</div>
              <div style={{ fontSize: 13, color: '#334155' }}>{isManager ? 'Upload the charge account PDF on ⚙️ Setup.' : 'A manager uploads the list.'}</div>
            </div>
          )}
          {uploadedAt && accounts.length > 0 && <div style={{ marginTop: 14, fontSize: 12, color: '#475569', textAlign: 'right' }}>List updated {uploadedAt}</div>}

        </div>
        )}
      </div>
    </div>
  );
}

// ── ⚙️ Setup (admin / managers) ───────────────────────────────────────────────
const FIELDS = [['name', 'Customer name'], ['id', 'Customer ID'], ['chargeAcct', 'Charge acct'], ['taxExempt', 'Tax exempt on file']];
const sInput = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.28)', borderRadius: 7, color: '#e2e8f0', padding: '6px 9px', fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' };
const sBtn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 8, padding: '7px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' });
const sCard = { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 14, padding: '18px 20px', marginBottom: 22 };
const yn = (v) => (v === 'Yes' ? '✓ Yes' : v === 'No' ? '✗ No' : '—');

// Old list vs a freshly read PDF, matched by customer ID.
function diffLists(oldList, newList) {
  const oldBy = new Map(oldList.map(a => [a.id, a]));
  const newBy = new Map(newList.map(a => [a.id, a]));
  const out = [];
  for (const n of newList) {
    const o = oldBy.get(n.id);
    if (!o) { out.push({ key: `add:${n.id}`, type: 'add', acct: n }); continue; }
    const fields = ['name', 'chargeAcct', 'taxExempt'].filter(k => String(o[k] || '') !== String(n[k] || ''));
    if (fields.length) out.push({ key: `chg:${n.id}`, type: 'change', acct: n, old: o, fields });
  }
  for (const o of oldList) if (!newBy.has(o.id)) out.push({ key: `del:${o.id}`, type: 'remove', acct: o });
  return out;
}

function ChargeSetup({ accounts, uploadedAt, onSaved, save: saveChargeAccounts }) {
  // ── Update from PDF ──
  const fileRef = useRef();
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [review, setReview] = useState(null);       // { fileName, parsed, changes }
  const [skip, setSkip] = useState({});             // change key → leave as it is
  const [msg, setMsg] = useState('');
  const [rawLines, setRawLines] = useState(null);
  const [saving, setSaving] = useState(false);

  async function readPdf(file) {
    if (!file?.name?.toLowerCase().endsWith('.pdf')) { setMsg('❌ Please choose the charge account PDF.'); return; }
    setReading(true); setMsg(''); setReview(null); setSkip({}); setRawLines(null);
    try {
      const lines = await extractLines(file);
      const parsed = parseAccounts(lines);
      if (!parsed.length) {
        setRawLines(lines);
        setMsg(`❌ Found 0 accounts in ${lines.length} lines — is this the charge account report? The raw text is below.`);
      } else {
        setReview({ fileName: file.name, parsed, changes: diffLists(accounts, parsed) });
      }
    } catch (e) { setMsg('❌ ' + (e.message || e)); }
    setReading(false);
  }

  async function saveReview() {
    if (!review) return;
    // Start from the list on file and apply only the ticked changes, so any
    // left unticked (e.g. a hand fix the PDF would undo) stay as they are.
    const on = (c) => !skip[c.key];
    const byId = new Map(accounts.map(a => [a.id, a]));
    for (const c of review.changes.filter(on)) {
      if (c.type === 'remove') byId.delete(c.acct.id);
      else byId.set(c.acct.id, { ...(byId.get(c.acct.id) || {}), ...c.acct });
    }
    // Keep the PDF's order; accounts it doesn't have (kept) go at the end.
    const order = review.parsed.map(a => a.id);
    const list = [...order.filter(id => byId.has(id)).map(id => byId.get(id)), ...[...byId.values()].filter(a => !order.includes(a.id))];
    const at = new Date().toLocaleString();
    setSaving(true);
    try {
      await saveChargeAccounts(list, at);
      onSaved(list, at);
      const n = review.changes.filter(on).length;
      setMsg(`✅ Saved — ${n} change${n === 1 ? '' : 's'} applied from ${review.fileName}.`);
      setReview(null);
    } catch (e) { setMsg('❌ Save failed: ' + (e.message || e)); }
    setSaving(false);
  }

  // ── Edit accounts ──
  const [draft, setDraft] = useState(() => accounts.map((a, i) => ({ ...a, _k: `k${i}` })));
  const [q, setQ] = useState('');
  const [editMsg, setEditMsg] = useState('');
  useEffect(() => { setDraft(accounts.map((a, i) => ({ ...a, _k: `k${i}` }))); }, [accounts]);
  const clean = (list) => list.map(({ _k, ...a }) => ({ ...a, name: String(a.name || '').trim().toUpperCase(), id: String(a.id || '').trim() }));
  const edits = JSON.stringify(clean(draft)) !== JSON.stringify(accounts.map(a => ({ ...a, name: String(a.name || '').trim().toUpperCase(), id: String(a.id || '').trim() })));
  const setRow = (k, field, v) => { setDraft(d => d.map(r => (r._k === k ? { ...r, [field]: v } : r))); setEditMsg(''); };
  const terms = q.trim().toLowerCase();
  const shown = draft.filter(r => r._new || !terms || `${r.name} ${r.id}`.toLowerCase().includes(terms));
  const dupIds = (() => { const seen = {}, d = new Set(); draft.forEach(r => { const id = String(r.id || '').trim(); if (id && seen[id]) d.add(id); seen[id] = 1; }); return d; })();

  async function saveEdits() {
    const list = clean(draft);
    if (list.some(a => !a.name || !a.id)) { setEditMsg('❌ Every account needs a name and a customer ID.'); return; }
    if (dupIds.size) { setEditMsg(`❌ Customer ID ${[...dupIds][0]} is on the list twice.`); return; }
    setSaving(true); setEditMsg('💾 Saving…');
    try {
      await saveChargeAccounts(list, uploadedAt);
      onSaved(list, uploadedAt);
      setEditMsg('✅ Saved.');
    } catch (e) { setEditMsg('❌ Save failed: ' + (e.message || e)); }
    setSaving(false);
  }

  const tag = (type) => {
    const [txt, rgb] = type === 'add' ? ['NEW', '74,222,128'] : type === 'remove' ? ['REMOVED', '248,113,113'] : ['CHANGED', '251,191,36'];
    return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 900, color: `rgb(${rgb})`, background: `rgba(${rgb},.14)`, border: `1px solid rgba(${rgb},.45)` }}>{txt}</span>;
  };
  const counts = review ? { add: review.changes.filter(c => c.type === 'add').length, change: review.changes.filter(c => c.type === 'change').length, remove: review.changes.filter(c => c.type === 'remove').length } : null;
  const ticked = review ? review.changes.filter(c => !skip[c.key]).length : 0;

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto' }}>
      {/* Update from the DMS PDF */}
      <div style={sCard}>
        <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9' }}>📄 Update from the charge account PDF</div>
        <div style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 12px' }}>
          Nothing changes until you look over what's different and click Save.{uploadedAt && <> Last updated <b style={{ color: '#cbd5e1' }}>{uploadedAt}</b>.</>}
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) readPdf(f); }}
          onClick={() => !reading && fileRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? 'rgba(61,214,195,.75)' : 'rgba(255,255,255,.14)'}`, borderRadius: 12, padding: '18px 24px', textAlign: 'center', cursor: reading ? 'wait' : 'pointer', background: dragOver ? 'rgba(61,214,195,.06)' : 'transparent', color: '#cbd5e1', fontWeight: 800, fontSize: 14 }}>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) readPdf(e.target.files[0]); e.target.value = ''; }} />
          {reading ? '⏳ Reading the PDF…' : '📤 Drop the charge account PDF here, or click to choose'}
        </div>
        {review && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 900, color: '#6ee7f9' }}>
                {review.fileName}: {review.parsed.length} accounts ·{' '}
                {review.changes.length ? `${counts.add} new · ${counts.change} changed · ${counts.remove} removed` : 'no changes — the list already matches'}
              </div>
              <div style={{ flex: 1 }} />
              <button disabled={saving} style={{ ...sBtn('74,222,128'), fontSize: 14, padding: '9px 18px' }} onClick={saveReview}>
                {saving ? '⏳ Saving…' : review.changes.length ? `💾 Save ${ticked} change${ticked === 1 ? '' : 's'}` : '💾 Save (stamp today’s date)'}
              </button>
              <button disabled={saving} style={sBtn('148,163,184', false)} onClick={() => setReview(null)}>Cancel</button>
            </div>
            {review.changes.length > 0 && (
              <>
                <div style={{ fontSize: 12.5, color: '#94a3b8', margin: '8px 0' }}>Untick anything you don't want — e.g. a fix you made by hand that the PDF would undo.</div>
                <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'auto' }}>
                    <thead><tr style={{ background: 'rgba(255,255,255,.05)' }}>
                      <th style={TH} /><th style={TH}>Change</th><th style={TH}>Customer</th><th style={TH}>ID</th><th style={TH}>What's different</th>
                    </tr></thead>
                    <tbody>
                      {review.changes.map(c => (
                        <tr key={c.key} style={{ borderTop: '1px solid rgba(255,255,255,.05)', opacity: skip[c.key] ? 0.45 : 1 }}>
                          <td style={{ padding: '8px 12px', width: 30 }}><input type="checkbox" checked={!skip[c.key]} onChange={e => setSkip(s => ({ ...s, [c.key]: !e.target.checked }))} /></td>
                          <td style={{ padding: '8px 12px' }}>{tag(c.type)}</td>
                          <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 700, whiteSpace: 'normal', overflow: 'visible' }}>{c.acct.name}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#6ee7f9' }}>{c.acct.id}</td>
                          <td style={{ padding: '8px 12px', color: '#cbd5e1', whiteSpace: 'normal', overflow: 'visible' }}>
                            {c.type === 'add' ? `Charge ${yn(c.acct.chargeAcct)} · Tax exempt ${yn(c.acct.taxExempt)}`
                              : c.type === 'remove' ? 'Not in the new PDF — comes off the list'
                              : c.fields.map(f => (
                                <div key={f}>{(FIELDS.find(x => x[0] === f) || [f, f])[1]}: <span style={{ color: '#fca5a5', textDecoration: 'line-through' }}>{f === 'name' ? c.old[f] : yn(c.old[f])}</span> → <b style={{ color: '#86efac' }}>{f === 'name' ? c.acct[f] : yn(c.acct[f])}</b></div>
                              ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
        {msg && <div style={{ marginTop: 10, fontSize: 13.5, fontWeight: 800, color: msg.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{msg}</div>}
        {rawLines && (
          <div style={{ marginTop: 12, background: '#0f172a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 14, maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap' }}>
            {rawLines.map((l, i) => `${String(i + 1).padStart(4, ' ')}  ${l}`).join('\n')}
          </div>
        )}
      </div>

      {/* Edit any account */}
      <div style={sCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9' }}>✏️ Edit accounts</div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Search name or ID…" style={{ ...sInput, maxWidth: 260 }} />
          <div style={{ flex: 1 }} />
          <button style={sBtn('110,231,249')} onClick={() => { setDraft(d => [{ _k: `n${Date.now()}`, _new: true, name: '', id: '', chargeAcct: 'Yes', taxExempt: 'No' }, ...d]); setEditMsg(''); }}>➕ Add account</button>
          {edits && <button disabled={saving} style={sBtn('148,163,184', false)} onClick={() => { setDraft(accounts.map((a, i) => ({ ...a, _k: `k${i}` }))); setEditMsg(''); }}>Undo changes</button>}
          <button disabled={saving || !edits} style={{ ...sBtn('74,222,128', edits), opacity: edits ? 1 : 0.5 }} onClick={saveEdits}>💾 Save changes</button>
        </div>
        {editMsg && <div style={{ marginBottom: 10, fontSize: 13.5, fontWeight: 800, color: editMsg.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{editMsg}</div>}
        <div style={{ maxHeight: 560, overflowY: 'auto', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'auto' }}>
            <thead><tr style={{ background: 'rgba(255,255,255,.05)', position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={TH}>Customer name</th><th style={TH}>Customer ID</th><th style={TH}>Charge acct</th><th style={TH}>Tax exempt on file</th><th style={TH} />
            </tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r._k} style={{ borderTop: '1px solid rgba(255,255,255,.05)', background: r._new ? 'rgba(110,231,249,.06)' : undefined }}>
                  <td style={{ padding: '5px 8px', minWidth: 260 }}><input value={r.name} onChange={e => setRow(r._k, 'name', e.target.value)} style={sInput} placeholder="Customer name" /></td>
                  <td style={{ padding: '5px 8px', width: 150 }}><input value={r.id} onChange={e => setRow(r._k, 'id', e.target.value)} placeholder="ID" style={{ ...sInput, fontFamily: 'monospace', ...(dupIds.has(String(r.id).trim()) ? { borderColor: 'rgba(248,113,113,.8)' } : null) }} /></td>
                  <td style={{ padding: '5px 8px', width: 120 }}>
                    <select value={r.chargeAcct} onChange={e => setRow(r._k, 'chargeAcct', e.target.value)} style={sInput}><option>Yes</option><option>No</option></select>
                  </td>
                  <td style={{ padding: '5px 8px', width: 150 }}>
                    <select value={r.taxExempt} onChange={e => setRow(r._k, 'taxExempt', e.target.value)} style={sInput}><option>Yes</option><option>No</option><option value="—">— (not shown)</option></select>
                  </td>
                  <td style={{ padding: '5px 8px', width: 40 }}>
                    <button title="Remove this account" onClick={() => { setDraft(d => d.filter(x => x._k !== r._k)); setEditMsg(''); }} style={{ ...sBtn('248,113,113', false), padding: '4px 9px' }}>✕</button>
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>{draft.length ? 'No accounts match.' : 'No accounts yet — upload the PDF above or add one.'}</td></tr>}
            </tbody>
          </table>
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
