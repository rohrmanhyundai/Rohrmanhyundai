import React, { useState, useEffect, useRef } from 'react';
import { loadHotRepairs, uploadHotRepair, deleteHotRepair, renameHotRepair, docRawUrl, getGithubToken, setGithubToken, loadUsers } from '../utils/github';
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
          <div className="doc-preview-title">
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

  const fileInputRef = useRef(null);

  useEffect(() => {
    trackPage('hotRepairs');
    loadHotRepairs().then(idx => {
      // newest first (index is already prepended, but sort to be safe)
      const sorted = [...(idx || [])].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      setItems(sorted);
      setLoading(false);
    });
  }, []);

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
      const newItems = await uploadHotRepair(file, label.trim(), currentUserDisplay || currentUser);
      const sorted = [...newItems].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      setItems(sorted);
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
      const newItems = await renameHotRepair(item.id, trimmed);
      const sorted = [...newItems].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      setItems(sorted);
      setEditId(null);
    } catch (err) {
      setActionError('Rename failed: ' + err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.label}"?\n\nThis cannot be undone.`)) return;
    setActionError('');
    try {
      const newItems = await deleteHotRepair(item);
      const sorted = [...newItems].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      setItems(sorted);
    } catch (err) {
      setActionError('Delete failed: ' + err.message);
    }
  }

  return (
    <div className="adv-page doc-lib-page">
      {/* Top bar */}
      <div className="adv-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="secondary" onClick={onBack}>{backLabel || '← Back'}</button>
          <span className="doc-lib-topbar-title">🔧 Hot Repairs — New Releases</span>
        </div>
      </div>

      <div className="doc-lib-wrap">

        {/* Upload Panel — managers/admins only */}
        {canManage && (
          <div className="doc-lib-upload-panel">
            <div className="doc-lib-panel-title">Upload New Hot Repair</div>
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
            Hot Repairs{!loading && <span className="doc-lib-count"> ({items.length})</span>}
          </div>

          {loading ? (
            <div className="doc-lib-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="doc-lib-empty">
              {canManage ? 'No hot repairs posted yet. Use the panel above to add one.' : 'No hot repairs have been posted yet.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 26 }}>
              {items.map(item => (
                <div key={item.id} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
              ))}
            </div>
          )}

          {actionError && !canManage && <div className="doc-lib-error" style={{ marginTop: 12 }}>{actionError}</div>}
        </div>

      </div>

      {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  );
}
