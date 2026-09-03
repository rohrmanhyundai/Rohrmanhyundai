import React, { useEffect, useMemo, useState } from 'react';
import { loadRegistrationIndex, removeRegistrationUpload, saveRegistrationUpload } from '../utils/github';
import { deleteS3ObjectByUrl } from '../utils/s3';

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
};

// The S3 object is cross-origin, so a plain <a download> would just open it in
// a tab. Pull the bytes down and hand the browser a blob it will actually save,
// falling back to opening the image if the fetch is blocked.
async function saveToPc(url, filename) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    return true;
  } catch {
    window.open(url, '_blank', 'noopener');
    return false;
  }
}

// Clipboard API needs a secure context; fall back to the old textarea trick so
// this still works if the page is ever served over plain http.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

export default function RegistrationUploads({ currentUser, currentUserDisplay, onBack, backLabel = '← Warranty Hub' }) {
  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [removing, setRemoving] = useState('');
  const [saved, setSaved] = useState('');
  const [copied, setCopied] = useState('');
  const [editingId, setEditingId] = useState('');
  const [roDraft, setRoDraft] = useState('');
  const [savingRo, setSavingRo] = useState('');
  // Set when the blob download couldn't run (S3 CORS) and we fell back to
  // opening the image — the hint tells them how to finish the save themselves.
  const [openedInTab, setOpenedInTab] = useState('');

  async function load() {
    setError('');
    try {
      const all = await loadRegistrationIndex();
      setRows(Array.isArray(all) ? all : []);
    } catch (e) {
      setError(e.message || 'Could not load registrations.');
      setRows([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = (rows || []).filter(r => !q
      || String(r.ro || '').toLowerCase().includes(q)
      || String(r.submittedByDisplay || r.submittedBy || '').toLowerCase().includes(q));
    return all.slice().sort((a, b) =>
      String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
  }, [rows, search]);

  // Say so when the browser refuses the clipboard rather than looking like
  // nothing happened — they can still select the number by hand.
  async function handleCopyRo(r) {
    if (!r.ro) return;
    const ok = await copyText(String(r.ro));
    setCopied(ok ? r.id : `fail:${r.id}`);
    setTimeout(() => setCopied(''), ok ? 1800 : 2600);
  }

  function startEdit(r) {
    setEditingId(r.id);
    setRoDraft(String(r.ro || ''));
    setError('');
  }

  // Writes the whole record back through the same upsert the phone uses, so a
  // correction can't race a fresh submission into overwriting the index.
  async function handleSaveRo(r) {
    const next = roDraft.trim();
    if (!next) { setError('The RO number can\'t be blank.'); return; }
    if (next === String(r.ro || '')) { setEditingId(''); return; }
    setSavingRo(r.id); setError('');
    try {
      const updated = await saveRegistrationUpload({ ...r, ro: next });
      setRows(Array.isArray(updated) ? updated
        : (rows || []).map(x => (x.id === r.id ? { ...x, ro: next } : x)));
      setEditingId('');
    } catch (e) {
      setError(e.message || 'Could not save the RO number.');
    } finally {
      setSavingRo('');
    }
  }

  async function handleDownload(r) {
    const ext = (r.photoUrl || '').split('.').pop().split('?')[0] || 'jpg';
    const ok = await saveToPc(r.photoUrl, `registration-RO${r.ro || r.id}.${ext}`);
    setSaved(ok ? r.id : '');
    setOpenedInTab(ok ? '' : r.id);
    if (ok) setTimeout(() => setSaved(''), 2500);
  }

  // Delete the image too — leaving orphaned registration photos in the bucket
  // defeats the point of removing the record. A failed S3 delete doesn't block
  // the index write; the record is what the Warranty Hub actually reads.
  async function handleDelete(r) {
    setRemoving(r.id); setError('');
    try {
      try { await deleteS3ObjectByUrl(r.photoUrl); } catch {}
      const next = await removeRegistrationUpload(r.id);
      setRows(Array.isArray(next) ? next : (rows || []).filter(x => x.id !== r.id));
      setConfirmDelete('');
      if (openId === r.id) setOpenId(null);
    } catch (e) {
      setError(e.message || 'Delete failed.');
    } finally {
      setRemoving('');
    }
  }

  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <div>
          <div className="adv-title">Registration Uploads</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
        </div>
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', width: '100%' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by RO or who sent it…"
              style={{
                flex: '1 1 260px', minWidth: 200, boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 14,
              }}
            />
            <div style={{ color: '#94a3b8', fontSize: 14 }}>
              {rows === null ? 'Loading…'
                : `${visible.length} registration${visible.length === 1 ? '' : 's'}`}
            </div>
            <button onClick={load} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              ↻ Refresh
            </button>
          </div>

          {error && (
            <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.45)', color: '#fca5a5', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}

          {rows !== null && visible.length === 0 && (
            <div style={{ color: '#7a92b8', fontSize: 14, padding: '20px 0' }}>
              {rows.length === 0 ? 'No registrations have been uploaded yet.' : 'Nothing matches that search.'}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visible.map(r => {
              const open = openId === r.id;
              return (
                <div key={r.id} style={{
                  background: r.originalOwner ? 'rgba(251,191,36,.07)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${r.originalOwner ? 'rgba(251,191,36,.6)' : 'rgba(56,189,248,.28)'}`,
                  borderLeft: r.originalOwner ? '5px solid #fbbf24' : '1px solid rgba(56,189,248,.28)',
                  borderRadius: 12, overflow: 'hidden',
                }}>
                  {/* A div, not a button — the RO number inside is its own
                      button, and nesting buttons isn't valid. */}
                  <div
                    onClick={() => { setOpenId(open ? null : r.id); setOpenedInTab(''); }}
                    style={{ width: '100%', cursor: 'pointer', padding: '14px 16px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <button
                        type="button"
                        title="Click to copy the RO number"
                        onClick={e => { e.stopPropagation(); handleCopyRo(r); }}
                        style={{
                          background: copied === r.id ? 'rgba(74,222,128,.15)'
                            : copied === `fail:${r.id}` ? 'rgba(248,113,113,.12)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${copied === r.id ? 'rgba(74,222,128,.5)'
                            : copied === `fail:${r.id}` ? 'rgba(248,113,113,.5)' : 'rgba(255,255,255,0.12)'}`,
                          color: copied === r.id ? '#4ade80' : '#e2e8f0',
                          fontWeight: 800, fontSize: 15, borderRadius: 8,
                          padding: '5px 10px', cursor: 'pointer', display: 'inline-flex',
                          alignItems: 'center', gap: 8, fontFamily: 'inherit',
                        }}>
                        RO {r.ro || '—'}
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          color: copied === r.id ? '#4ade80' : copied === `fail:${r.id}` ? '#fca5a5' : '#64748b',
                        }}>
                          {copied === r.id ? '✓ Copied'
                            : copied === `fail:${r.id}` ? '✗ Copy blocked — select it by hand'
                            : '⧉ Copy'}
                        </span>
                      </button>
                      {r.originalOwner && (
                        <span style={{
                          display: 'inline-block', marginLeft: 8, verticalAlign: 'middle',
                          background: 'rgba(251,191,36,.2)', border: '1px solid rgba(251,191,36,.65)',
                          color: '#fbbf24', borderRadius: 999, padding: '4px 11px',
                          fontSize: 11, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap',
                        }}>
                          ⚠️ ORIGINAL OWNER
                        </span>
                      )}
                      <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 5 }}>
                        {r.submittedByDisplay || r.submittedBy || 'Unknown'} · {fmtDate(r.submittedAt)}
                      </div>
                    </div>
                    <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>{open ? '▲ Hide' : '▼ View'}</span>
                  </div>

                  {open && (
                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                      {r.originalOwner && (
                        <div style={{
                          marginTop: 14, background: 'rgba(251,191,36,.12)',
                          border: '1px solid rgba(251,191,36,.55)', borderRadius: 10,
                          padding: '12px 14px', color: '#fbbf24', fontWeight: 800, fontSize: 14, lineHeight: 1.45,
                        }}>
                          ⚠️ Customer is the ORIGINAL OWNER — original owner form must be completed.
                        </div>
                      )}

                      {r.photoUrl ? (
                        <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 14 }}>
                          <img src={r.photoUrl} alt={`Registration for RO ${r.ro}`}
                            style={{ maxWidth: '100%', maxHeight: 560, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)' }} />
                        </a>
                      ) : (
                        <div style={{ color: '#f87171', fontSize: 13, fontWeight: 600, marginTop: 14 }}>⚠️ No photo on this record.</div>
                      )}

                      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                        {r.photoUrl && (
                          <button
                            onClick={() => handleDownload(r)}
                            style={{
                              background: 'linear-gradient(180deg,#38bdf8,#0284c7)', color: '#06232f',
                              border: '1px solid rgba(56,189,248,.6)', borderRadius: 10,
                              padding: '11px 22px', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                            }}>
                            ⬇ Download to PC
                          </button>
                        )}
                        {saved === r.id && (
                          <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 700 }}>✓ Saved</span>
                        )}
                        {openedInTab === r.id && (
                          <span style={{ color: '#fcd34d', fontSize: 12.5, fontWeight: 600 }}>
                            Opened in a new tab — right-click the image and choose “Save image as…”
                          </span>
                        )}

                        {editingId === r.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <input
                              value={roDraft}
                              onChange={e => setRoDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveRo(r);
                                if (e.key === 'Escape') setEditingId('');
                              }}
                              autoFocus
                              inputMode="numeric"
                              placeholder="RO number"
                              style={{
                                width: 140, boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
                                border: '1px solid rgba(251,191,36,.6)', borderRadius: 8,
                                color: '#e2e8f0', padding: '10px 12px', fontSize: 15, fontWeight: 700,
                              }}
                            />
                            <button
                              onClick={() => handleSaveRo(r)}
                              disabled={savingRo === r.id}
                              style={{
                                background: 'linear-gradient(180deg,#f59e0b,#d97706)', color: '#1a1206',
                                border: '1px solid rgba(251,191,36,.6)', borderRadius: 8,
                                padding: '9px 18px', fontSize: 13, fontWeight: 800,
                                cursor: savingRo === r.id ? 'wait' : 'pointer',
                              }}>
                              {savingRo === r.id ? '⏳ Saving…' : 'Save RO'}
                            </button>
                            <button
                              onClick={() => setEditingId('')}
                              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(r)}
                            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 10, padding: '11px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                            ✏️ Edit RO
                          </button>
                        )}

                        {confirmDelete === r.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginLeft: 'auto' }}>
                            <span style={{ color: '#fca5a5', fontSize: 13, fontWeight: 700 }}>
                              Delete RO {r.ro} and its photo for good?
                            </span>
                            <button
                              onClick={() => handleDelete(r)}
                              disabled={removing === r.id}
                              style={{
                                background: 'linear-gradient(180deg,#ef4444,#b91c1c)', color: '#fff',
                                border: '1px solid rgba(248,113,113,.6)', borderRadius: 8,
                                padding: '8px 18px', fontSize: 13, fontWeight: 800,
                                cursor: removing === r.id ? 'wait' : 'pointer',
                              }}>
                              {removing === r.id ? '⏳ Deleting…' : 'Yes, delete it'}
                            </button>
                            <button
                              onClick={() => setConfirmDelete('')}
                              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(r.id)}
                            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#7a92b8', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                            🗑 Delete this registration
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
