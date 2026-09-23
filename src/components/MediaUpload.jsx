import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addWarrantyMedia, loadWarrantyMedia, loadWarrantyIndex, normalizeRo } from '../utils/github';
import { uploadWarrantyMediaToS3, ensureAwsCreds } from '../utils/s3';

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const fmtShort = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
};

const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const CARD = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 12,
  padding: '14px 16px',
  marginBottom: 12,
};

const LABEL = {
  color: '#7a92b8', fontSize: 12, fontWeight: 700,
  letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6, display: 'block',
};

const INPUT = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0',
  padding: '11px 12px', fontSize: 16, // 16px keeps iOS Safari from zooming on focus
};

const SMALL_BTN = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1',
  borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
};

// Phone page for aftermarket warranty photos and videos. The RO number comes
// first and is required — it is the only thing that ties the media to the
// contract on the After Market Warranty page.
export default function MediaUpload({ currentUser, currentUserDisplay, onBack }) {
  const [ro, setRo] = useState('');
  const [files, setFiles] = useState([]);          // { id, file, preview, kind, progress }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);          // { ro, count }
  const [sent, setSent] = useState(null);          // null = loading
  const [contracts, setContracts] = useState([]);
  const photoRef = useRef(null);
  const videoRef = useRef(null);
  const libraryRef = useRef(null);

  const roKey = normalizeRo(ro);
  const hasRo = roKey.length > 0;
  const canSubmit = hasRo && files.length > 0 && !saving;

  const contract = useMemo(
    () => (hasRo ? contracts.find(c => normalizeRo(c.repairOrder) === roKey) : null),
    [contracts, roKey, hasRo],
  );

  async function loadSent() {
    try { setSent(await loadWarrantyMedia()); } catch { setSent([]); }
  }

  useEffect(() => {
    loadSent();
    loadWarrantyIndex().then(c => setContracts(Array.isArray(c) ? c : [])).catch(() => {});
  }, []);

  // Object URLs for the thumbnails are freed when the file leaves the list.
  useEffect(() => () => files.forEach(f => URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(e) {
    const input = e.target;
    const picked = Array.from(input.files || []);
    input.value = '';
    if (!picked.length) return;
    const ok = picked.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (ok.length < picked.length) setError('Only pictures and videos can be uploaded.');
    else setError('');
    setDone(null);
    setFiles(prev => [...prev, ...ok.map(file => ({
      id: genId(),
      file,
      preview: URL.createObjectURL(file),
      kind: file.type.startsWith('video/') ? 'video' : 'image',
      progress: 0,
    }))]);
  }

  function removeFile(id) {
    setFiles(prev => {
      const f = prev.find(x => x.id === id);
      if (f) URL.revokeObjectURL(f.preview);
      return prev.filter(x => x.id !== id);
    });
  }

  function pick(ref) {
    if (!hasRo) { setError('Enter the RO number first.'); return; }
    setError('');
    ref.current?.click();
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true); setError('');
    const roSafe = roKey.replace(/[^A-Z0-9-]+/g, '_');
    const records = [];
    try {
      if (!(await ensureAwsCreds())) throw new Error('Please sign in again.');
      for (const f of files) {
        const ext = (f.file.name.split('.').pop() || (f.kind === 'video' ? 'mov' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '');
        const url = await uploadWarrantyMediaToS3(`${roSafe}/${f.id}.${ext}`, f.file,
          p => setFiles(prev => prev.map(x => (x.id === f.id ? { ...x, progress: p } : x))));
        setFiles(prev => prev.map(x => (x.id === f.id ? { ...x, progress: 1 } : x)));
        records.push({
          id: f.id,
          ro: roKey,
          url,
          name: f.file.name || `${f.kind}.${ext}`,
          type: f.file.type || '',
          kind: f.kind,
          size: f.file.size,
          uploadedBy: (currentUser || '').toUpperCase(),
          uploadedByDisplay: currentUserDisplay || currentUser || '',
          uploadedAt: new Date().toISOString(),
        });
      }
      await addWarrantyMedia(records);
      files.forEach(f => URL.revokeObjectURL(f.preview));
      setDone({ ro: roKey, count: records.length, hasContract: !!contract });
      setFiles([]); setRo('');
      loadSent();
    } catch (err) {
      // Anything already in the bucket is recorded so a retry of the rest
      // doesn't leave those files orphaned.
      let saved = 0;
      if (records.length) {
        try {
          await addWarrantyMedia(records);
          saved = records.length;
          const doneIds = new Set(records.map(r => r.id));
          setFiles(prev => prev.filter(x => !doneIds.has(x.id)));
        } catch {}
      }
      setError((err.message || 'Submit failed.') + (saved ? ` ${saved} file(s) were saved — tap Submit to send the rest.` : ' Try again.'));
    } finally {
      setSaving(false);
    }
  }

  // Receipts: one row per RO per person per submit, newest first.
  const receipts = useMemo(() => {
    if (!Array.isArray(sent)) return null;
    const groups = new Map();
    for (const m of sent) {
      const k = `${m.ro}|${m.uploadedBy}|${(m.uploadedAt || '').slice(0, 16)}`;
      const g = groups.get(k) || { key: k, ro: m.ro, by: m.uploadedByDisplay || m.uploadedBy, at: m.uploadedAt, photos: 0, videos: 0 };
      if (m.kind === 'video') g.videos++; else g.photos++;
      groups.set(k, g);
    }
    return [...groups.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30);
  }, [sent]);

  return (
    <div style={{ minHeight: '100vh', background: '#0d1627', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '16px 14px 40px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ color: '#3dd6c3', fontWeight: 800, fontSize: 18 }}>Media Upload</div>
          <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 2 }}>Aftermarket warranty pictures &amp; videos · {currentUserDisplay || currentUser}</div>
        </div>
        <button onClick={onBack} disabled={saving} style={{ ...SMALL_BTN, padding: '8px 12px', fontWeight: 700, flexShrink: 0 }}>
          ← Back
        </button>
      </div>

      {done && (
        <div style={{ ...CARD, borderColor: 'rgba(74,222,128,.45)', background: 'rgba(74,222,128,.08)' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#4ade80', marginBottom: 6 }}>Submitted</div>
          <div style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.5 }}>
            {done.count} file{done.count === 1 ? '' : 's'} for RO <strong>{done.ro}</strong> {done.count === 1 ? 'was' : 'were'} sent to the After Market Warranty page.
            {!done.hasContract && ' There is no contract for this RO yet — the media will show on it as soon as one is created.'}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div style={{ ...CARD, borderColor: 'rgba(61,214,195,.3)', background: 'rgba(61,214,195,.07)' }}>
        <div style={{ color: '#3dd6c3', fontWeight: 800, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
          How to use this
        </div>
        <ol style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 14, lineHeight: 1.65 }}>
          <li>Enter the <strong>repair order number</strong> first — nothing can be uploaded without it.</li>
          <li>Tap <strong>Take Picture</strong> or <strong>Record Video</strong>, or choose ones already on your phone. You can add as many as you need.</li>
          <li>Show the failed part clearly: the part number/label, the damage or leak, and the mileage on the dash.</li>
          <li>Check the list, remove anything that's wrong, then tap <strong>Submit</strong>.</li>
          <li>Stay on this screen until it says <strong>Submitted</strong> — videos can take a minute on cell data.</li>
        </ol>
        <div style={{ color: '#7a92b8', fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
          Everything is saved to the aftermarket warranty contract with the same RO number, under its <strong>Media Uploads</strong> tab.
        </div>
      </div>

      {/* Step 1: RO number */}
      <div style={CARD}>
        <label style={LABEL}>1 · Repair Order Number <span style={{ color: '#f87171' }}>*required</span></label>
        <input
          value={ro}
          onChange={e => { setRo(e.target.value); setDone(null); }}
          placeholder="e.g. 781013"
          inputMode="numeric"
          disabled={saving}
          style={INPUT}
        />
        {!hasRo ? (
          <div style={{ color: '#f87171', fontSize: 12, marginTop: 6, fontWeight: 600 }}>
            Enter the RO number before adding pictures or videos.
          </div>
        ) : contract ? (
          <div style={{ color: '#4ade80', fontSize: 12.5, marginTop: 6, fontWeight: 700 }}>
            ✓ Contract found: {contract.customerName || 'customer'}{contract.vehicleYear ? ` · ${contract.vehicleYear} ${contract.vehicleMake || ''} ${contract.vehicleModel || ''}` : ''}
          </div>
        ) : (
          <div style={{ color: '#fbbf24', fontSize: 12.5, marginTop: 6, fontWeight: 600 }}>
            No contract with this RO yet — double-check the number. It's fine to upload now; it will attach when the contract is created.
          </div>
        )}
      </div>

      {/* Step 2: media */}
      <div style={{ ...CARD, opacity: hasRo ? 1 : 0.5 }}>
        <label style={LABEL}>2 · Pictures &amp; Videos <span style={{ color: '#f87171' }}>*required</span></label>
        <input ref={photoRef} type="file" accept="image/*" capture="environment" onChange={addFiles} style={{ display: 'none' }} />
        <input ref={videoRef} type="file" accept="video/*" capture="environment" onChange={addFiles} style={{ display: 'none' }} />
        <input ref={libraryRef} type="file" accept="image/*,video/*" multiple onChange={addFiles} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => pick(photoRef)} disabled={saving}
            style={{ flex: 1, background: 'rgba(61,214,195,.1)', border: '1px dashed rgba(61,214,195,.5)', color: '#e2e8f0', borderRadius: 10, padding: '18px 8px', cursor: hasRo ? 'pointer' : 'not-allowed', fontSize: 14.5, fontWeight: 800 }}>
            📷 Take Picture
          </button>
          <button type="button" onClick={() => pick(videoRef)} disabled={saving}
            style={{ flex: 1, background: 'rgba(192,132,252,.1)', border: '1px dashed rgba(192,132,252,.5)', color: '#e2e8f0', borderRadius: 10, padding: '18px 8px', cursor: hasRo ? 'pointer' : 'not-allowed', fontSize: 14.5, fontWeight: 800 }}>
            🎥 Record Video
          </button>
        </div>
        <button type="button" onClick={() => pick(libraryRef)} disabled={saving}
          style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: '#7a92b8', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline', cursor: hasRo ? 'pointer' : 'not-allowed', padding: 4 }}>
          Choose pictures or videos already on this phone
        </button>

        {files.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {files.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 8 }}>
                <div style={{ width: 56, height: 56, borderRadius: 8, overflow: 'hidden', background: '#000', flexShrink: 0, position: 'relative' }}>
                  {f.kind === 'video'
                    ? <video src={f.preview} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <img src={f.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {f.kind === 'video' && <span style={{ position: 'absolute', left: 3, bottom: 1, fontSize: 13 }}>🎥</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.kind === 'video' ? 'Video' : 'Picture'} · {fmtSize(f.file.size)}
                  </div>
                  {saving || f.progress > 0 ? (
                    <div style={{ marginTop: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round(f.progress * 100)}%`, height: '100%', background: f.progress >= 1 ? '#4ade80' : '#3dd6c3', transition: 'width .2s' }} />
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#7a92b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</div>
                  )}
                </div>
                <button type="button" onClick={() => removeFile(f.id)} disabled={saving} title="Remove"
                  style={{ ...SMALL_BTN, color: '#f87171', borderColor: 'rgba(248,113,113,.35)', flexShrink: 0 }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...CARD, borderColor: 'rgba(248,113,113,.45)', background: 'rgba(248,113,113,.1)', color: '#fca5a5', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          width: '100%', marginTop: 4, borderRadius: 10, padding: '15px 12px',
          fontSize: 16, fontWeight: 800, cursor: canSubmit ? 'pointer' : 'not-allowed',
          background: canSubmit ? 'linear-gradient(180deg,#3dd6c3,#0d9488)' : 'rgba(255,255,255,0.06)',
          color: canSubmit ? '#04211d' : '#64748b',
          border: `1px solid ${canSubmit ? 'rgba(61,214,195,.6)' : 'rgba(255,255,255,0.12)'}`,
        }}>
        {saving ? '⏳ Uploading… keep this screen open' : `Submit${files.length ? ` ${files.length} file${files.length === 1 ? '' : 's'}` : ''}`}
      </button>

      {/* Sent receipts */}
      <div style={{ ...CARD, marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={LABEL}>Recently Sent</span>
          <button type="button" onClick={loadSent}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#7a92b8', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
            ↻ Refresh
          </button>
        </div>
        {receipts === null ? (
          <div style={{ color: '#7a92b8', fontSize: 13 }}>Loading…</div>
        ) : receipts.length === 0 ? (
          <div style={{ color: '#7a92b8', fontSize: 13 }}>Nothing has been sent in yet.</div>
        ) : receipts.map(r => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 15 }}>RO {r.ro}</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>
              {r.photos ? `📷 ${r.photos}` : ''}{r.photos && r.videos ? ' ' : ''}{r.videos ? `🎥 ${r.videos}` : ''}
            </span>
            <span style={{ marginLeft: 'auto', color: '#7a92b8', fontSize: 12, textAlign: 'right' }}>
              {r.by}{r.at ? ` · ${fmtShort(r.at)}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
