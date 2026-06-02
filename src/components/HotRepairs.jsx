import React, { useState, useEffect, useRef } from 'react';
import { loadHotRepairs, uploadHotRepair, deleteHotRepair, docRawUrl, getGithubToken, setGithubToken, loadUsers } from '../utils/github';
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
            <div className="doc-lib-list">
              {items.map(item => (
                <div key={item.id} className="doc-lib-item">
                  <div className="doc-lib-item-icon" style={{ fontSize: 30 }}>🔧</div>
                  <div className="doc-lib-item-info">
                    <div className="doc-lib-item-label">
                      {item.label}
                      {isNew(item.uploadedAt) && (
                        <span style={{ marginLeft: 10, background: '#ef4444', color: '#fff', borderRadius: 20, fontSize: 10, fontWeight: 900, padding: '2px 8px', letterSpacing: 0.5, verticalAlign: 'middle' }}>NEW</span>
                      )}
                    </div>
                    <div className="doc-lib-item-meta">
                      PDF &nbsp;·&nbsp; {formatSize(item.size)} &nbsp;·&nbsp;
                      Posted by <strong>{item.uploadedBy}</strong> &nbsp;·&nbsp; {formatDate(item.uploadedAt)}
                    </div>
                  </div>
                  <div className="doc-lib-item-actions">
                    <button onClick={() => setPreviewItem(item)}>👁 View</button>
                    {canManage && (
                      <button className="secondary adv-del-btn" onClick={() => handleDelete(item)} title="Delete">×</button>
                    )}
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
