import React, { useState, useEffect, useRef } from 'react';
import { loadDocumentIndex, uploadDocument, deleteDocument, updateDocumentPermissions, docRawUrl, getGithubToken, setGithubToken, loadUsers } from '../utils/github';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

// All selectable roles for document permissions
const DOC_ROLES = [
  { key: 'advisor',         label: 'Advisor' },
  { key: 'technician',      label: 'Technician' },
  { key: 'parts',           label: 'Parts' },
  { key: 'parts manager',   label: 'Parts Manager' },
  { key: 'service manager', label: 'Service Manager' },
  { key: 'general manager', label: 'General Manager' },
];

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

function roleLabel(key) {
  return DOC_ROLES.find(r => r.key === key)?.label || key;
}

// ── Role Checkboxes ───────────────────────────────────────────────────────────
function RoleCheckboxes({ selected, onChange }) {
  const allChecked = selected.length === 0;

  function toggleAll() {
    onChange([]); // empty = all roles
  }

  function toggleRole(key) {
    if (selected.includes(key)) {
      onChange(selected.filter(k => k !== key));
    } else {
      onChange([...selected, key]);
    }
  }

  return (
    <div style={{ padding: '18px 0 4px' }}>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14, lineHeight: 1.6 }}>
        Select which roles can view this document. Check <strong style={{ color: '#6ee7f9' }}>All Roles</strong> to make it visible to everyone, or pick specific roles below.
      </div>

      {/* All Roles toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 14, padding: '10px 14px', background: allChecked ? 'rgba(61,214,195,.12)' : 'rgba(255,255,255,.03)', border: `1px solid ${allChecked ? 'rgba(61,214,195,.35)' : 'rgba(255,255,255,.07)'}`, borderRadius: 10, transition: 'all .15s' }}>
        <input
          type="checkbox"
          checked={allChecked}
          onChange={toggleAll}
          style={{ width: 16, height: 16, accentColor: '#3dd6c3', cursor: 'pointer' }}
        />
        <span style={{ fontWeight: 700, fontSize: 14, color: allChecked ? '#6ee7f9' : '#94a3b8' }}>🌐 All Roles (public)</span>
      </label>

      {/* Per-role checkboxes — always enabled; clicking one auto-unchecks "All Roles" */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
        {DOC_ROLES.map(role => {
          const checked = selected.includes(role.key);
          return (
            <label
              key={role.key}
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '9px 12px', background: checked ? 'rgba(110,231,249,.1)' : 'rgba(255,255,255,.03)', border: `1px solid ${checked ? 'rgba(110,231,249,.3)' : 'rgba(255,255,255,.07)'}`, borderRadius: 9, transition: 'all .15s' }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleRole(role.key)}
                style={{ width: 15, height: 15, accentColor: '#6ee7f9', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, color: checked ? '#e2e8f0' : '#94a3b8', fontWeight: checked ? 600 : 400 }}>{role.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Permission Badge ──────────────────────────────────────────────────────────
function PermBadge({ allowedRoles }) {
  if (!allowedRoles || allowedRoles.length === 0) return (
    <span style={{ fontSize: 11, color: '#64748b', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 6, padding: '2px 7px' }}>🌐 All</span>
  );
  return (
    <span style={{ fontSize: 11, color: '#fbbf24', background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.25)', borderRadius: 6, padding: '2px 7px' }}>
      🔒 {allowedRoles.map(roleLabel).join(', ')}
    </span>
  );
}

// ── Edit Permissions Modal ────────────────────────────────────────────────────
function EditPermModal({ doc, onSave, onClose, saving }) {
  const [roles, setRoles] = useState(doc.allowedRoles || []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#0f172a', border: '1px solid rgba(61,214,195,.25)', borderRadius: 18, padding: '28px 32px', minWidth: 460, maxWidth: 560, boxShadow: '0 24px 64px rgba(0,0,0,.6)' }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#6ee7f9', marginBottom: 4 }}>🔒 Edit Permissions</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>{doc.label}</div>
        <RoleCheckboxes selected={roles} onChange={setRoles} />
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button onClick={() => onSave(roles)} disabled={saving}
            style={{ background: 'linear-gradient(135deg,rgba(61,214,195,.3),rgba(110,231,249,.2))', border: '1px solid rgba(61,214,195,.4)', color: '#6ee7f9', borderRadius: 8, padding: '8px 22px', cursor: 'pointer', fontWeight: 700 }}>
            {saving ? 'Saving...' : 'Save Permissions'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Document Preview Modal ────────────────────────────────────────────────────
function PreviewModal({ doc, onClose }) {
  const rawUrl = docRawUrl(doc.filename);
  const [loading, setLoading] = useState(true);

  const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(rawUrl)}&embedded=true`;

  async function handleDownload() {
    try {
      const res  = await fetch(rawUrl);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = doc.filename.replace(/^[a-z0-9]+-/, '');
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
            <span className="doc-preview-icon">{fileIcon(doc.fileType)}</span>
            <span>{doc.label}</span>
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
            title={doc.label}
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main Document Library ─────────────────────────────────────────────────────
export default function DocumentLibrary({ currentUser, currentRole, onBack, backLabel }) {
  const canManage = currentRole === 'admin' || (currentRole || '').includes('manager');
  const isAdminOrManager = canManage;

  const [docs, setDocs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [label, setLabel]             = useState('');
  const [file, setFile]               = useState(null);
  const [fileError, setFileError]     = useState('');
  const [actionError, setActionError] = useState('');
  const [previewDoc, setPreviewDoc]   = useState(null);

  // Upload panel tabs
  const [uploadTab, setUploadTab]     = useState('upload'); // 'upload' | 'permissions'
  const [uploadRoles, setUploadRoles] = useState([]);       // [] = all roles

  // Edit-permissions modal
  const [editPermDoc, setEditPermDoc]   = useState(null);
  const [savingPerms, setSavingPerms]   = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    loadDocumentIndex().then(index => {
      setDocs(index || []);
      setLoading(false);
    });
  }, []);

  // Filter docs by role — admins/managers always see all
  const visibleDocs = docs.filter(doc => {
    if (isAdminOrManager) return true;
    if (!doc.allowedRoles || doc.allowedRoles.length === 0) return true;
    return doc.allowedRoles.includes(currentRole);
  });

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

  async function ensureToken() {
    if (!getGithubToken()) {
      try {
        const result = await loadUsers();
        const shared = result?.sharedSaveCode;
        if (shared) setGithubToken(shared);
      } catch {}
    }
    if (!getGithubToken()) {
      const code = prompt('This device needs a one-time save code to upload documents.\n\nEnter the save code (ask your admin for it):');
      if (!code) return false;
      setGithubToken(code.trim());
    }
    return true;
  }

  async function handleUpload() {
    if (!file || !label.trim()) { setFileError('Please select a file and enter a label.'); return; }
    setActionError('');
    if (!await ensureToken()) return;

    setUploading(true);
    setUploadStatus(file.size > 5 * 1024 * 1024 ? 'Uploading large file — please wait...' : 'Uploading...');
    try {
      const newDocs = await uploadDocument(file, label.trim(), currentUser, uploadRoles);
      setDocs(newDocs);
      setFile(null); setLabel(''); setFileError(''); setUploadRoles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadStatus('');
      setUploadTab('upload');
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

  async function handleSavePerms(roles) {
    setSavingPerms(true);
    try {
      if (!await ensureToken()) { setSavingPerms(false); return; }
      const newDocs = await updateDocumentPermissions(editPermDoc.id, roles);
      setDocs(newDocs);
      setEditPermDoc(null);
    } catch (err) {
      setActionError('Permission save failed: ' + err.message);
    } finally {
      setSavingPerms(false);
    }
  }

  return (
    <div className="adv-page doc-lib-page">
      {/* Top bar */}
      <div className="adv-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="secondary" onClick={onBack}>{backLabel || '← Back to Calendar'}</button>
          <span className="doc-lib-topbar-title">Document Library</span>
        </div>
      </div>

      <div className="doc-lib-wrap">

        {/* Upload Panel */}
        {canManage && (
          <div className="doc-lib-upload-panel">
            {/* Panel header + tabs */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div className="doc-lib-panel-title" style={{ marginBottom: 0 }}>Upload New Document</div>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.05)', borderRadius: 10, padding: 4 }}>
                <button
                  onClick={() => setUploadTab('upload')}
                  style={{
                    background: uploadTab === 'upload' ? 'rgba(61,214,195,.2)' : 'transparent',
                    border: uploadTab === 'upload' ? '1px solid rgba(61,214,195,.4)' : '1px solid transparent',
                    color: uploadTab === 'upload' ? '#6ee7f9' : '#64748b',
                    borderRadius: 7, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'all .15s',
                  }}
                >
                  📤 Upload
                </button>
                <button
                  onClick={() => setUploadTab('permissions')}
                  style={{
                    background: uploadTab === 'permissions' ? 'rgba(251,191,36,.15)' : 'transparent',
                    border: uploadTab === 'permissions' ? '1px solid rgba(251,191,36,.4)' : '1px solid transparent',
                    color: uploadTab === 'permissions' ? '#fbbf24' : '#64748b',
                    borderRadius: 7, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'all .15s',
                  }}
                >
                  🔒 Permissions
                </button>
              </div>
            </div>

            {/* Upload tab */}
            {uploadTab === 'upload' && (
              <>
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
                {/* Permission summary pill */}
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b' }}>
                  Visibility when uploaded:&nbsp;
                  <PermBadge allowedRoles={uploadRoles} />
                  <button
                    onClick={() => setUploadTab('permissions')}
                    style={{ background: 'none', border: 'none', color: '#6ee7f9', fontSize: 12, cursor: 'pointer', padding: '2px 6px', textDecoration: 'underline' }}
                  >
                    Change
                  </button>
                </div>
                {fileError   && <div className="doc-lib-error">{fileError}</div>}
                {actionError && <div className="doc-lib-error">{actionError}</div>}
              </>
            )}

            {/* Permissions tab */}
            {uploadTab === 'permissions' && (
              <>
                <RoleCheckboxes selected={uploadRoles} onChange={setUploadRoles} />
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    These permissions will apply to the next document you upload.
                  </div>
                  <button
                    onClick={() => setUploadTab('upload')}
                    style={{ background: 'linear-gradient(135deg,rgba(61,214,195,.25),rgba(110,231,249,.15))', border: '1px solid rgba(61,214,195,.4)', color: '#6ee7f9', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
                  >
                    ← Back to Upload
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Document List */}
        <div className="doc-lib-list-section">
          <div className="doc-lib-panel-title">
            Documents{!loading && <span className="doc-lib-count"> ({visibleDocs.length})</span>}
          </div>

          {loading ? (
            <div className="doc-lib-empty">Loading documents...</div>
          ) : visibleDocs.length === 0 ? (
            <div className="doc-lib-empty">
              {canManage ? 'No documents uploaded yet. Use the panel above to add one.' : 'No documents have been uploaded yet.'}
            </div>
          ) : (
            <div className="doc-lib-list">
              {visibleDocs.map(doc => (
                <div key={doc.id} className="doc-lib-item">
                  <div className="doc-lib-item-icon">{fileIcon(doc.fileType)}</div>
                  <div className="doc-lib-item-info">
                    <div className="doc-lib-item-label">{doc.label}</div>
                    <div className="doc-lib-item-meta">
                      {doc.fileType.toUpperCase()} &nbsp;·&nbsp; {formatSize(doc.size)} &nbsp;·&nbsp;
                      Uploaded by <strong>{doc.uploadedBy}</strong> &nbsp;·&nbsp; {formatDate(doc.uploadedAt)}
                      &nbsp;·&nbsp; <PermBadge allowedRoles={doc.allowedRoles} />
                    </div>
                  </div>
                  <div className="doc-lib-item-actions">
                    <button onClick={() => setPreviewDoc(doc)}>👁 Preview</button>
                    {canManage && (
                      <>
                        <button
                          onClick={() => setEditPermDoc(doc)}
                          title="Edit permissions"
                          style={{ background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.3)', color: '#fbbf24', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
                        >
                          🔒
                        </button>
                        <button className="secondary adv-del-btn" onClick={() => handleDelete(doc)} title="Delete document">×</button>
                      </>
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

      {/* Edit Permissions Modal */}
      {editPermDoc && (
        <EditPermModal
          doc={editPermDoc}
          onSave={handleSavePerms}
          onClose={() => setEditPermDoc(null)}
          saving={savingPerms}
        />
      )}
    </div>
  );
}
