import React, { useState, useEffect, useRef } from 'react';
import { loadHotRepairs, uploadHotRepair, deleteHotRepair, renameHotRepair, reorderHotRepairs, setHotRepairWarranty, docRawUrl, getGithubToken, setGithubToken, loadUsers } from '../utils/github';
import { trackPage } from '../utils/activityTracker';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const NEW_DAYS = 7; // show NEW badge for items uploaded within this many days

function formatSize(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function isNew(iso) {
  try { return (Date.now() - new Date(iso).getTime()) < NEW_DAYS * 24 * 60 * 60 * 1000; }
  catch { return false; }
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
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

// Cache rendered previews (data URLs) by item id so we only render once.
const previewCache = {};

// Cache extracted first-page text (for search) by item id.
const textCache = {};

// Normalize a string for forgiving search: lowercase, strip everything but
// letters/digits. So "26-01-045H" and "2601045h" and "26 01 045 h" all match.
function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Extract the first page's text from a PDF (cached). Used only for search.
async function extractFirstPageText(item, rawUrl) {
  if (textCache[item.id] != null) return textCache[item.id];
  try {
    const pdfjs = await loadPdfJs();
    const res = await fetch(rawUrl);
    const buf = await res.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map(i => i.str).join(' ');
    textCache[item.id] = text;
    return text;
  } catch {
    textCache[item.id] = '';
    return '';
  }
}

// Does an item match the query? Each whitespace-separated token must appear
// (normalized) in the title or the extracted first-page text.
function itemMatches(item, query) {
  const haystack = norm(item.label) + ' ' + norm(textCache[item.id] || '');
  const tokens = query.trim().split(/\s+/).filter(Boolean).map(norm).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every(tok => haystack.includes(tok));
}

// Renders a large image of page 1 of the PDF; falls back to a wrench icon.
function PdfPreview({ item, rawUrl }) {
  const [thumb, setThumb] = useState(() => previewCache[item.id] || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (thumb || failed) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const res = await fetch(rawUrl);
        const buf = await res.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = 1000 / viewport.width; // render at high resolution for large cards
        const scaled = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = scaled.width;
        canvas.height = scaled.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
        const url = canvas.toDataURL('image/png');
        previewCache[item.id] = url;
        if (!cancelled) setThumb(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [item.id, rawUrl, thumb, failed]);

  if (thumb) {
    return (
      <img src={thumb} alt={item.label}
        style={{ width: '100%', display: 'block', objectFit: 'cover', objectPosition: 'top', background: '#fff' }} />
    );
  }
  return (
    <div style={{ width: '100%', aspectRatio: '3 / 4', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.03)', color: '#64748b', fontSize: 48 }}>
      {failed ? '🔧' : <span style={{ fontSize: 13 }}>Loading preview…</span>}
    </div>
  );
}

// ── PDF Preview Modal ─────────────────────────────────────────────────────────
function PreviewModal({ item, onClose }) {
  const rawUrl = docRawUrl(item.filename);
  const [loading, setLoading] = useState(true);
  const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(rawUrl)}&embedded=true`;

  async function handleDownload() {
    try {
      const res  = await fetch(rawUrl);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = item.filename.replace(/^[a-z0-9]+-/, '');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { window.open(rawUrl, '_blank'); }
  }

  function handlePrint() {
    window.open(`https://docs.google.com/gview?url=${encodeURIComponent(rawUrl)}`, '_blank');
  }

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="doc-preview-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="doc-preview-modal">
        <div className="doc-preview-header">
          <div className="doc-preview-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="secondary" onClick={onClose}>← Back</button>
            <span className="doc-preview-icon">🔧</span>
            <span>{item.label}</span>
          </div>
          <div className="doc-preview-actions">
            <button onClick={handlePrint}>🖨 Print</button>
            <button onClick={handleDownload}>⬇ Download</button>
            <button className="secondary adv-del-btn" onClick={onClose} title="Close preview" style={{ fontSize: 20 }}>×</button>
          </div>
        </div>
        <div className="doc-preview-body">
          {loading && <div className="doc-preview-loading">Loading preview…</div>}
          <iframe
            src={viewerUrl}
            className="doc-preview-iframe"
            style={{ display: loading ? 'none' : 'block' }}
            title={item.label}
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main Hot Repairs Page ─────────────────────────────────────────────────────
export default function HotRepairs({ currentUser, currentUserDisplay, currentRole, onBack, backLabel }) {
  const canManage = currentRole === 'admin' || (currentRole || '').includes('manager');

  const [items, setItems]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [label, setLabel]             = useState('');
  const [file, setFile]               = useState(null);
  const [fileError, setFileError]     = useState('');
  const [actionError, setActionError] = useState('');
  const [previewItem, setPreviewItem] = useState(null);
  const [editId, setEditId]           = useState(null);
  const [editLabel, setEditLabel]     = useState('');
  const [savingEdit, setSavingEdit]   = useState(false);
  const [reordering, setReordering]   = useState(false);
  const [tab, setTab]                 = useState('hot-repairs'); // 'hot-repairs' | 'recalls'
  const [search, setSearch]           = useState('');
  const [textVer, setTextVer]         = useState(0); // bumps as PDF text finishes extracting
  const [indexing, setIndexing]       = useState(false);

  const fileInputRef = useRef(null);

  const isRecalls = tab === 'recalls';
  const tabNoun = isRecalls ? 'Recall' : 'Hot Repair';

  useEffect(() => {
    trackPage(isRecalls ? 'recalls' : 'hotRepairs');
    setLoading(true);
    setEditId(null); setPreviewItem(null); setSearch('');
    setFile(null); setLabel(''); setFileError(''); setActionError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    let cancelled = false;
    loadHotRepairs(tab).then(idx => {
      if (cancelled) return;
      const list = idx || [];
      // Display follows the stored order (newest uploads prepend; managers can reorder).
      setItems(list);
      setLoading(false);
      // Pre-extract first-page text in the background so search is ready & fast.
      if (list.length) {
        setIndexing(true);
        Promise.allSettled(list.map(it => extractFirstPageText(it, docRawUrl(it.filename))))
          .then(() => { if (!cancelled) { setIndexing(false); setTextVer(v => v + 1); } });
      }
    });
    return () => { cancelled = true; };
  }, [tab]);

  // Items to display, filtered by the live search query.
  const filteredItems = search.trim() ? items.filter(it => itemMatches(it, search)) : items;
  // eslint-disable-next-line no-unused-expressions
  textVer; // referenced so filtering recomputes as extraction completes

  function runSearchOpen() {
    const matches = items.filter(it => itemMatches(it, search));
    if (matches.length >= 1) setPreviewItem(matches[0]);
  }

  // Auto-open when the search narrows to exactly one PDF (won't reopen the same
  // one after you close it unless the query changes).
  const autoOpenedRef = useRef(null);
  useEffect(() => {
    if (!search.trim()) { autoOpenedRef.current = null; return; }
    const matches = items.filter(it => itemMatches(it, search));
    if (matches.length === 1 && autoOpenedRef.current !== matches[0].id) {
      autoOpenedRef.current = matches[0].id;
      setPreviewItem(matches[0]);
    }
  }, [search, textVer, items]);

  function handleFileChange(e) {
    const f = e.target.files[0];
    setFileError('');
    if (!f) { setFile(null); return; }
    if (f.size > MAX_SIZE) {
      setFileError('File exceeds 50 MB limit. Please choose a smaller file.');
      setFile(null); e.target.value = ''; return;
    }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'pdf') {
      setFileError('Only PDF files are allowed for hot repairs.');
      setFile(null); e.target.value = ''; return;
    }
    setFile(f);
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '));
  }

  async function ensureToken() {
    if (!getGithubToken()) {
      try {
        const result = await loadUsers();
        const shared = result?.sharedSaveCode;
        if (shared) setGithubToken(shared);
      } catch {}
    }
    if (!getGithubToken()) {
      const code = prompt('This device needs a one-time save code to upload.\n\nEnter the save code (ask your admin for it):');
      if (!code) return false;
      setGithubToken(code.trim());
    }
    return true;
  }

  async function handleUpload() {
    if (!file || !label.trim()) { setFileError('Please select a PDF and enter a title.'); return; }
    setActionError('');
    if (!await ensureToken()) return;

    setUploading(true);
    setUploadStatus(file.size > 5 * 1024 * 1024 ? 'Uploading large file — please wait...' : 'Uploading...');
    try {
      const newItems = await uploadHotRepair(file, label.trim(), currentUserDisplay || currentUser, tab);
      setItems(newItems); // new upload is prepended → appears on top
      setFile(null); setLabel(''); setFileError('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadStatus('');
    } catch (err) {
      setActionError('Upload failed: ' + err.message);
      setUploadStatus('');
    } finally {
      setUploading(false);
    }
  }

  function startEdit(item) {
    setEditId(item.id);
    setEditLabel(item.label);
  }

  async function saveEdit(item) {
    const trimmed = editLabel.trim();
    if (!trimmed || trimmed === item.label) { setEditId(null); return; }
    setActionError('');
    if (!await ensureToken()) return;
    setSavingEdit(true);
    try {
      const newItems = await renameHotRepair(item.id, trimmed, tab);
      setItems(newItems);
      setEditId(null);
    } catch (err) {
      setActionError('Rename failed: ' + err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleWarranty(item) {
    setActionError('');
    if (!await ensureToken()) return;
    // optimistic
    const next = items.map(i => i.id === item.id ? { ...i, warranty: !i.warranty } : i);
    setItems(next);
    try {
      const saved = await setHotRepairWarranty(item.id, !item.warranty, tab);
      setItems(saved);
    } catch (err) {
      setItems(items); // revert
      setActionError('Update failed: ' + err.message);
    }
  }

  // Move an item to a new position; optimistic UI then persist order.
  async function move(index, toIndex) {
    if (toIndex < 0 || toIndex >= items.length || toIndex === index) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(toIndex, 0, moved);
    setItems(next); // optimistic
    setReordering(true);
    setActionError('');
    try {
      if (!await ensureToken()) { setItems(items); setReordering(false); return; }
      const saved = await reorderHotRepairs(next.map(i => i.id), tab);
      setItems(saved);
    } catch (err) {
      setItems(items); // revert
      setActionError('Reorder failed: ' + err.message);
    } finally {
      setReordering(false);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.label}"?\n\nThis cannot be undone.`)) return;
    setActionError('');
    try {
      const newItems = await deleteHotRepair(item, tab);
      setItems(newItems);
    } catch (err) {
      setActionError('Delete failed: ' + err.message);
    }
  }

  return (
    <div className="adv-page doc-lib-page">
      <style>{`
        @keyframes hrWarrantyPulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(251,191,36,.12); }
          50%      { box-shadow: 0 0 0 7px rgba(251,191,36,.28); }
        }
      `}</style>
      {/* Top bar */}
      <div className="adv-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="secondary" onClick={onBack}>{backLabel || '← Back'}</button>
          <span className="doc-lib-topbar-title">{isRecalls ? '📢 Recalls' : '🔧 Hot Repairs — New Releases'}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 24px 0', justifyContent: 'center' }}>
        {[
          { key: 'hot-repairs', label: '🔧 Hot Repairs' },
          { key: 'recalls',     label: '📢 Recalls' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? 'linear-gradient(135deg,rgba(61,214,195,.28),rgba(110,231,249,.18))' : 'rgba(255,255,255,.04)',
              border: tab === t.key ? '2px solid rgba(61,214,195,.6)' : '1px solid rgba(255,255,255,.1)',
              color: tab === t.key ? '#6ee7f9' : '#94a3b8',
              borderRadius: 12, padding: '10px 28px', cursor: 'pointer', fontWeight: 800, fontSize: 15,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div style={{ padding: '16px 24px 0', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 760, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, opacity: 0.7 }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearchOpen(); if (e.key === 'Escape') setSearch(''); }}
            placeholder={isRecalls
              ? 'Search recalls — title, recall/bulletin number, keyword (e.g. "299" or "26-01-045H")'
              : 'Search hot repairs — title, bulletin number, keyword (e.g. "299" or "26-TC-001H")'}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '12px 40px 12px 40px',
              background: 'rgba(255,255,255,.05)', border: '1px solid rgba(110,231,249,.3)',
              borderRadius: 12, color: '#e2e8f0', fontSize: 15, outline: 'none',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} title="Clear"
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
          )}
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, paddingLeft: 4 }}>
            {indexing
              ? '⏳ Scanning PDF contents for search…'
              : search.trim()
                ? `${filteredItems.length} match${filteredItems.length === 1 ? '' : 'es'} — press Enter to open the top result`
                : 'Searches the title and the first page of every uploaded PDF.'}
          </div>
        </div>
      </div>

      <div className="doc-lib-wrap">

        {/* Upload Panel — managers/admins only */}
        {canManage && (
          <div className="doc-lib-upload-panel">
            <div className="doc-lib-panel-title">{isRecalls ? 'Upload New Recall Bulletin' : 'Upload New Hot Repair'}</div>
            <div className="doc-lib-upload-row">
              <input ref={fileInputRef} type="file" accept=".pdf"
                onChange={handleFileChange} style={{ display: 'none' }} id="hot-repair-file-input" />
              <label htmlFor="hot-repair-file-input" className={`doc-lib-file-pick${file ? ' doc-lib-file-pick--selected' : ''}`}>
                {file ? `✔ ${file.name}` : '📂 Choose PDF'}
              </label>
              <input className="doc-lib-label-input"
                placeholder="Title (what techs will see)"
                value={label} onChange={e => setLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !uploading && file && label.trim() && handleUpload()}
                maxLength={80} />
              <button onClick={handleUpload} disabled={uploading || !file || !label.trim()}>
                {uploading ? (uploadStatus || 'Uploading...') : 'Upload'}
              </button>
            </div>
            {file && !fileError && (
              <div className="doc-lib-file-info">
                {file.name} &nbsp;·&nbsp; {formatSize(file.size)}
                {file.size > 5 * 1024 * 1024 && <span className="doc-lib-warn"> &nbsp;⚠ Large file — upload may take 30–60 seconds</span>}
              </div>
            )}
            {fileError   && <div className="doc-lib-error">{fileError}</div>}
            {actionError && <div className="doc-lib-error">{actionError}</div>}
          </div>
        )}

        {/* List */}
        <div className="doc-lib-list-section">
          <div className="doc-lib-panel-title">
            {isRecalls ? 'Recalls' : 'Hot Repairs'}{!loading && <span className="doc-lib-count"> ({search.trim() ? `${filteredItems.length} of ${items.length}` : items.length})</span>}
          </div>

          {loading ? (
            <div className="doc-lib-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="doc-lib-empty">
              {canManage
                ? `No ${isRecalls ? 'recalls' : 'hot repairs'} posted yet. Use the panel above to add one.`
                : `No ${isRecalls ? 'recalls' : 'hot repairs'} have been posted yet.`}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="doc-lib-empty">
              No matches for “{search.trim()}”. Try a different number or keyword.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 26 }}>
              {filteredItems.map((item) => {
                const idx = items.indexOf(item);
                return (
                <div key={item.id} style={{
                  background: item.warranty ? 'rgba(251,191,36,.06)' : 'rgba(255,255,255,.03)',
                  border: item.warranty ? '2px solid rgba(251,191,36,.85)' : '1px solid rgba(255,255,255,.08)',
                  borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                  boxShadow: item.warranty ? '0 0 0 4px rgba(251,191,36,.15)' : 'none',
                  animation: item.warranty ? 'hrWarrantyPulse 1.8s ease-in-out infinite' : 'none',
                }}>
                  {/* Highlight banner */}
                  {item.warranty && (
                    <div style={{ background: 'linear-gradient(90deg,#f59e0b,#fbbf24)', color: '#3a2400', fontWeight: 900, fontSize: 14, letterSpacing: 0.6, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isRecalls ? '⚠️ URGENT RECALL — ACTION REQUIRED' : '⚠️ WARRANTY HOT REPAIR — REVIEW BEFORE PERFORMING'}
                    </div>
                  )}
                  {/* Large preview — click to open full view */}
                  <div
                    onClick={() => setPreviewItem(item)}
                    title="Click to view full PDF"
                    style={{ position: 'relative', cursor: 'pointer', maxHeight: 720, overflow: 'hidden', borderBottom: '1px solid rgba(255,255,255,.08)' }}
                  >
                    <PdfPreview item={item} rawUrl={docRawUrl(item.filename)} />
                    {isNew(item.uploadedAt) && (
                      <span style={{ position: 'absolute', top: 12, left: 12, background: '#ef4444', color: '#fff', borderRadius: 20, fontSize: 12, fontWeight: 900, padding: '4px 12px', letterSpacing: 0.5, boxShadow: '0 2px 8px rgba(0,0,0,.4)' }}>NEW</span>
                    )}
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.55)', opacity: 0, transition: 'opacity .15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                      onMouseLeave={e => e.currentTarget.style.opacity = 0}>
                      <span style={{ background: 'rgba(61,214,195,.9)', color: '#04201d', fontWeight: 800, fontSize: 16, padding: '10px 22px', borderRadius: 10 }}>👁 View Full</span>
                    </div>
                  </div>

                  {/* Info + actions */}
                  <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                    {editId === item.id ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          className="doc-lib-label-input"
                          autoFocus
                          value={editLabel}
                          maxLength={80}
                          onChange={e => setEditLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(item); if (e.key === 'Escape') setEditId(null); }}
                          style={{ flex: 1, fontSize: 16, fontWeight: 700 }}
                        />
                        <button onClick={() => saveEdit(item)} disabled={savingEdit}>{savingEdit ? '…' : 'Save'}</button>
                        <button className="secondary" onClick={() => setEditId(null)} disabled={savingEdit}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ fontWeight: 800, fontSize: 17, color: '#e2e8f0', lineHeight: 1.3 }}>{item.label}</div>
                    )}
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {formatSize(item.size)} · Posted by <strong style={{ color: '#94a3b8' }}>{item.uploadedBy}</strong> · {formatDate(item.uploadedAt)}
                    </div>
                    {canManage && editId !== item.id && (
                      <button onClick={() => toggleWarranty(item)} title="Toggle Warranty Hot Repair highlight"
                        style={{
                          background: item.warranty ? 'linear-gradient(135deg,#f59e0b,#fbbf24)' : 'rgba(251,191,36,.12)',
                          border: '1px solid rgba(251,191,36,.5)',
                          color: item.warranty ? '#3a2400' : '#fbbf24',
                          borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                        }}>
                        {isRecalls
                          ? (item.warranty ? '⚠️ Urgent Recall: ON' : '🛡 Mark as Urgent Recall')
                          : (item.warranty ? '⚠️ Warranty Hot Repair: ON' : '🛡 Mark as Warranty Hot Repair')}
                      </button>
                    )}
                    {canManage && editId !== item.id && !search.trim() && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => move(idx, 0)} disabled={reordering || idx === 0} title="Move to top"
                          style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)', color: '#c4b5fd', borderRadius: 8, padding: '5px 10px', cursor: idx === 0 ? 'default' : 'pointer', fontWeight: 700, fontSize: 12, opacity: idx === 0 ? 0.4 : 1 }}>
                          ⤒ Top
                        </button>
                        <button onClick={() => move(idx, idx - 1)} disabled={reordering || idx === 0} title="Move up"
                          style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)', color: '#c4b5fd', borderRadius: 8, padding: '5px 10px', cursor: idx === 0 ? 'default' : 'pointer', fontWeight: 700, fontSize: 12, opacity: idx === 0 ? 0.4 : 1 }}>
                          ↑ Up
                        </button>
                        <button onClick={() => move(idx, idx + 1)} disabled={reordering || idx === items.length - 1} title="Move down"
                          style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)', color: '#c4b5fd', borderRadius: 8, padding: '5px 10px', cursor: idx === items.length - 1 ? 'default' : 'pointer', fontWeight: 700, fontSize: 12, opacity: idx === items.length - 1 ? 0.4 : 1 }}>
                          ↓ Down
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                      <button onClick={() => setPreviewItem(item)} style={{ flex: 1 }}>👁 View</button>
                      {canManage && editId !== item.id && (
                        <button onClick={() => startEdit(item)} title="Rename"
                          style={{ background: 'rgba(110,231,249,.12)', border: '1px solid rgba(110,231,249,.3)', color: '#6ee7f9', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                          ✏️ Rename
                        </button>
                      )}
                      {canManage && (
                        <button className="secondary adv-del-btn" onClick={() => handleDelete(item)} title="Delete">×</button>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {actionError && !canManage && <div className="doc-lib-error" style={{ marginTop: 12 }}>{actionError}</div>}
        </div>

      </div>

      {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  );
}
