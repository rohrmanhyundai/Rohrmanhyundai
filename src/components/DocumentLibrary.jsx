import React, { useState, useEffect, useRef } from 'react';
import { loadDocumentIndex, uploadDocument, deleteDocument, docRawUrl, getGithubToken, setGithubToken } from '../utils/github';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

function fileIcon(type) {
  if (type === 'pdf')  return '📄';
  if (type === 'docx' || type === 'doc') return '📝';
  return '📎';
}

function formatSize(bytes) {
  if (bytes < 1024)            return bytes + ' B';
  if (bytes < 1024 * 1024)     return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

export default function DocumentLibrary({ currentUser, currentRole, onBack }) {
  const canManage = currentRole === 'admin' || currentRole === 'service manager';

  const [docs, setDocs]                   = useState([]);
  const [loading, setLoading]             = useState(true);
  const [uploading, setUploading]         = useState(false);
  const [uploadStatus, setUploadStatus]   = useState('');
  const [label, setLabel]                 = useState('');
  const [file, setFile]                   = useState(null);
  const [fileError, setFileError]         = useState('');
  const [actionError, setActionError]     = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadDocumentIndex().then(index => {
      setDocs(index || []);
      setLoading(false);
    });
  }, []);

  function openDoc(doc) {
    const rawUrl = docRawUrl(doc.filename);
    if (doc.fileType === 'pdf') {
      window.open(rawUrl, '_blank');
    } else {
      // Word docs via Microsoft Office Online viewer (free, no login)
      window.open(`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(rawUrl)}`, '_blank');
    }
  }

  function handleFileChange(e) {
    const f = e.target.files[0];
    setFileError('');
    if (!f) { setFile(null); return; }
    if (f.size > MAX_SIZE) {
      setFileError('File exceeds 50 MB limit. Please choose a smaller file.');
      setFile(null);
      e.target.value = '';
      return;
    }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'doc', 'docx'].includes(ext)) {
      setFileError('Only PDF and Word documents (.pdf, .doc, .docx) are allowed.');
      setFile(null);
      e.target.value = '';
      return;
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
      setFile(null);
      setLabel('');
      setFileError('');
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

        {/* ── Upload Panel (admin / service manager only) ── */}
        {canManage && (
          <div className="doc-lib-upload-panel">
            <div className="doc-lib-panel-title">Upload New Document</div>
            <div className="doc-lib-upload-row">
              {/* Hidden real file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                id="doc-file-input"
              />
              {/* Styled file picker button */}
              <label htmlFor="doc-file-input" className={`doc-lib-file-pick${file ? ' doc-lib-file-pick--selected' : ''}`}>
                {file ? `✔ ${file.name}` : '📂 Choose File'}
              </label>
              <input
                className="doc-lib-label-input"
                placeholder="Document label (what users will see)"
                value={label}
                onChange={e => setLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !uploading && file && label.trim() && handleUpload()}
                maxLength={80}
              />
              <button onClick={handleUpload} disabled={uploading || !file || !label.trim()}>
                {uploading ? (uploadStatus || 'Uploading...') : 'Upload'}
              </button>
            </div>
            {file && !fileError && (
              <div className="doc-lib-file-info">
                {file.name} &nbsp;·&nbsp; {formatSize(file.size)}
                {file.size > 5 * 1024 * 1024 && (
                  <span className="doc-lib-warn"> &nbsp;⚠ Large file — upload may take 30–60 seconds</span>
                )}
              </div>
            )}
            {fileError   && <div className="doc-lib-error">{fileError}</div>}
            {actionError && <div className="doc-lib-error">{actionError}</div>}
          </div>
        )}

        {/* ── Document List ── */}
        <div className="doc-lib-list-section">
          <div className="doc-lib-panel-title">
            Documents
            {!loading && <span className="doc-lib-count"> ({docs.length})</span>}
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
                      {doc.fileType.toUpperCase()} &nbsp;·&nbsp; {formatSize(doc.size)} &nbsp;·&nbsp; Uploaded by <strong>{doc.uploadedBy}</strong> &nbsp;·&nbsp; {formatDate(doc.uploadedAt)}
                    </div>
                  </div>
                  <div className="doc-lib-item-actions">
                    <button onClick={() => openDoc(doc)}>
                      Open
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
    </div>
  );
}
