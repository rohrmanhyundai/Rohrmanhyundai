import React, { useState, useEffect, useRef } from 'react';
import { loadDocumentIndex, uploadDocument, deleteDocument, docRawUrl, getGithubToken, setGithubToken } from '../utils/github';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

function fileIcon(type) {
  if (type === 'pdf') return '📄';
  if (type === 'docx' || type === 'doc') return '📝';
  return '📎';
}

function formatSize(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

// ── Document Preview Modal ────────────────────────────────────────────────────
function PreviewModal({ doc, onClose }) {
  const rawUrl = docRawUrl(doc.filename);
  const isPdf  = doc.fileType === 'pdf';
  const iframeRef = useRef(null);
  const [loading, setLoading] = useState(true);

  // Build embed URL
  const embedUrl = isPdf
    ? rawUrl
    : `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(rawUrl)}`;

  // Download: fetch as blob so the browser saves the file rather than opening it
  async function handleDownload() {
    try {
      const res = await fetch(rawUrl);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = doc.filename.replace(/^[a-z0-9]+-/, ''); // strip the id prefix
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      // Fallback: just open the raw URL in a new tab
      window.open(rawUrl, '_blank');
    }
  }

  // Print: for PDFs we call print on the iframe; for Word the viewer has its own print button
  function handlePrint() {
    if (isPdf) {
      try {
        iframeRef.current?.contentWindow?.print();
      } catch {
        window.open(rawUrl, '_blank'); // cross-origin fallback — opens & user prints
      }
    } else {
      // Office Online has a print button built-in; also let user open in full viewer
      window.open(`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(rawUrl)}`, '_blank');
    }
  }

  // Close on Escape key
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="doc-preview-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="doc-preview-modal">
        {/* Header */}
        <div className="doc-preview-header">
          <div className="doc-preview-title">
            <span className="doc-preview-icon">{fileIcon(doc.fileType)}</span>
            <span>{doc.label}</span>
          </div>
          <div className="doc-preview-actions">
            {!isPdf && (
              <span className="doc-preview-hint">Word doc — use Print button inside the viewer</span>
            )}
            <button onClick={handlePrint} title={isPdf ? 'Print document' : 'Open in full viewer to print'}>
              🖨 {isPdf ? 'Print' : 'Open to Print'}
            </button>
            <button onClick={handleDownload} title="Download file">
              ⬇ Download
            </button>
            <button className="secondary adv-del-btn" onClick={onClose} title="Close preview" style={{ fontSize: 20 }}>×</button>
          </div>
        </div>

        {/* Iframe viewer */}
        <div className="doc-preview-body">
          {loading && (
            <div className="doc-preview-loading">Loading document…</div>
          )}
          <iframe
            ref={iframeRef}
            src={embedUrl}
            className="doc-preview-iframe"
            title={doc.label}
            onLoad={() => setLoading(false)}
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}

// ── Main Document Library ─────────────────────────────────────────────────────
export default function DocumentLibrary({ currentUser, currentRole, onBack }) {
  const canManage = currentRole === 'admin' || currentRole === 'service manager';

  const [docs, setDocs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [label, setLabel]             = useState('');
  const [file, setFile]               = useState(null);
  const [fileError, setFileError]     = useState('');
  const [actionError, setActionError] = useState('');
  const [previewDoc, setPreviewDoc]   = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadDocumentIndex().then(index => {
      setDocs(index || []);
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
    if (!['pdf', 'doc', 'docx'].includes(ext)) {
      setFileError('Only PDF and Word documents (.pdf, .doc, .docx) are allowed.');
      setFile(null); e.target.value = ''; return;
    }
    setFile(f);
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '));
  }

  async function handleUpload() {
    if (!file || !label.trim()) { setFileError('Please select a file and enter a label.'); return; }
    setActionError('');

    if (!getGithubToken()) {
      const code = prompt('This device needs a one-time save code to upload documents.\n\nEnter the save code (ask your admin for it):');
      if (!code) return;
      setGithubToken(code.trim());
    }

    setUploading(true);
    setUploadStatus(file.size > 5 * 1024 * 1024 ? 'Uploading large file — please wait...' : 'Uploading...');
    try {
      const newDocs = await uploadDocument(file, label.trim(), currentUser);
      setDocs(newDocs);
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

  async function handleDelete(doc) {
    if (!window.confirm(`Delete "${doc.label}"?\n\nThis cannot be undone.`)) return;
    setActionError('');
    try {
      const newDocs = await deleteDocument(doc);
      setDocs(newDocs);
    } catch (err) {
      setActionError('Delete failed: ' + err.message);
    }
  }

  return (
    <div className="adv-page doc-lib-page">
      {/* Top bar */}
      <div className="adv-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="secondary" onClick={onBack}>← Back to Calendar</button>
          <span className="doc-lib-topbar-title">Document Library</span>
        </div>
      </div>

      <div className="doc-lib-wrap">

        {/* Upload Panel */}
        {canManage && (
          <div className="doc-lib-upload-panel">
            <div className="doc-lib-panel-title">Upload New Document</div>
            <div className="doc-lib-upload-row">
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx"
                onChange={handleFileChange} style={{ display: 'none' }} id="doc-file-input" />
              <label htmlFor="doc-file-input" className={`doc-lib-file-pick${file ? ' doc-lib-file-pick--selected' : ''}`}>
                {file ? `✔ ${file.name}` : '📂 Choose File'}
              </label>
              <input className="doc-lib-label-input"
                placeholder="Document label (what users will see)"
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

        {/* Document List */}
        <div className="doc-lib-list-section">
          <div className="doc-lib-panel-title">
            Documents{!loading && <span className="doc-lib-count"> ({docs.length})</span>}
          </div>

          {loading ? (
            <div className="doc-lib-empty">Loading documents...</div>
          ) : docs.length === 0 ? (
            <div className="doc-lib-empty">
              {canManage ? 'No documents uploaded yet. Use the panel above to add one.' : 'No documents have been uploaded yet.'}
            </div>
          ) : (
            <div className="doc-lib-list">
              {docs.map(doc => (
                <div key={doc.id} className="doc-lib-item">
                  <div className="doc-lib-item-icon">{fileIcon(doc.fileType)}</div>
                  <div className="doc-lib-item-info">
                    <div className="doc-lib-item-label">{doc.label}</div>
                    <div className="doc-lib-item-meta">
                      {doc.fileType.toUpperCase()} &nbsp;·&nbsp; {formatSize(doc.size)} &nbsp;·&nbsp;
                      Uploaded by <strong>{doc.uploadedBy}</strong> &nbsp;·&nbsp; {formatDate(doc.uploadedAt)}
                    </div>
                  </div>
                  <div className="doc-lib-item-actions">
                    <button onClick={() => setPreviewDoc(doc)}>
                      👁 Preview
                    </button>
                    {canManage && (
                      <button className="secondary adv-del-btn" onClick={() => handleDelete(doc)} title="Delete document">×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {actionError && !canManage && <div className="doc-lib-error" style={{ marginTop: 12 }}>{actionError}</div>}
        </div>

      </div>

      {/* Preview Modal */}
      {previewDoc && <PreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />}
    </div>
  );
}
