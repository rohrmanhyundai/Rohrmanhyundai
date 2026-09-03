import React, { useEffect, useRef, useState } from 'react';
import { saveRegistrationUpload, loadRegistrationIndex } from '../utils/github';
import { uploadRegistrationPhotoToS3, ensureAwsCreds } from '../utils/s3';

const fmtShort = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

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

// Send-and-forget by design: once it's submitted the photo is gone from this
// screen for good. Only the Warranty Hub reads registrations back.
export default function RegistrationUpload({ currentUser, currentUserDisplay, onBack }) {
  const [ro, setRo] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoName, setPhotoName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [doneRo, setDoneRo] = useState('');
  // Receipt list at the bottom — RO numbers only, never the photos. It's the
  // proof the send landed, and it stops two people uploading the same RO.
  const [sent, setSent] = useState(null); // null = loading
  // Two inputs: the first has capture="environment", which is what makes a
  // phone open the camera straight away instead of the file picker.
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);
  const idRef = useRef(genId());

  const canSubmit = ro.trim().length > 0 && !!photoUrl && !uploading && !saving;

  async function loadSent() {
    try {
      const all = await loadRegistrationIndex();
      setSent(Array.isArray(all) ? all : []);
    } catch { setSent([]); }
  }

  useEffect(() => { loadSent(); /* eslint-disable-next-line */ }, []);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    const input = e.target;
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image.'); return; }
    setError(''); setUploading(true);
    try {
      if (!(await ensureAwsCreds())) { setError('AWS setup required — ask a manager.'); return; }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const url = await uploadRegistrationPhotoToS3(`${idRef.current}-${Date.now()}.${ext}`, file);
      setPhotoUrl(url);
      setPhotoName(file.name || 'photo');
    } catch (err) {
      setError('Upload failed: ' + (err.message || err));
    } finally {
      setUploading(false);
      if (input) input.value = '';
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true); setError('');
    try {
      await saveRegistrationUpload({
        id: idRef.current,
        ro: ro.trim(),
        photoUrl,
        submittedBy: (currentUser || '').toUpperCase(),
        submittedByDisplay: currentUserDisplay || currentUser || '',
        submittedAt: new Date().toISOString(),
      });
      setDoneRo(ro.trim());
      loadSent();
      // Wipe every trace of the photo from this screen.
      idRef.current = genId();
      setRo(''); setPhotoUrl(''); setPhotoName('');
    } catch (err) {
      setError(err.message || 'Submit failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1627', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '16px 14px 40px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: 18 }}>Vehicle Registration Upload</div>
          <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 2 }}>{currentUserDisplay || currentUser}</div>
        </div>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
          ← Back
        </button>
      </div>

      {doneRo && (
        <div style={{ ...CARD, borderColor: 'rgba(74,222,128,.45)', background: 'rgba(74,222,128,.08)' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#4ade80', marginBottom: 6 }}>Submitted</div>
          <div style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.5 }}>
            The registration for RO <strong>{doneRo}</strong> has been sent to the Warranty department.
          </div>
        </div>
      )}

      {/* Instructions */}
      <div style={{ ...CARD, borderColor: 'rgba(56,189,248,.3)', background: 'rgba(56,189,248,.07)' }}>
        <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
          How to use this
        </div>
        <ol style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 14, lineHeight: 1.65 }}>
          <li>Enter the <strong>repair order number</strong>.</li>
          <li>Take a <strong>picture of the registration</strong>.</li>
          <li>Tap Submit.</li>
        </ol>
      </div>

      {/* RO number */}
      <div style={CARD}>
        <label style={LABEL}>Repair Order Number <span style={{ color: '#f87171' }}>*required</span></label>
        <input
          value={ro}
          onChange={e => setRo(e.target.value)}
          placeholder="e.g. 780544"
          inputMode="numeric"
          style={INPUT}
        />
        {!ro.trim() && (
          <div style={{ color: '#f87171', fontSize: 12, marginTop: 6, fontWeight: 600 }}>
            You can't submit without the RO number.
          </div>
        )}
      </div>

      {/* Registration photo */}
      <div style={CARD}>
        <label style={LABEL}>Picture of the Registration <span style={{ color: '#f87171' }}>*required</span></label>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
        <input ref={libraryRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
        {photoUrl ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(74,222,128,.08)', border: '1px solid rgba(74,222,128,.35)',
            borderRadius: 10, padding: '12px 14px',
          }}>
            <span style={{ fontSize: 26 }}>📄</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#4ade80', fontWeight: 800 }}>✓ Photo attached</div>
              <div style={{ fontSize: 12, color: '#7a92b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {photoName}
              </div>
            </div>
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={uploading}
              style={{ flexShrink: 0, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              {uploading ? 'Uploading…' : '📷 Retake'}
            </button>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={uploading}
              style={{ width: '100%', background: 'rgba(56,189,248,.1)', border: '1px dashed rgba(56,189,248,.5)', color: '#e2e8f0', borderRadius: 10, padding: '22px 12px', cursor: 'pointer', fontSize: 15, fontWeight: 800 }}>
              {uploading ? '⏳ Uploading…' : '📷 Tap to Take Photo of the Registration'}
            </button>
            <button type="button" onClick={() => libraryRef.current?.click()} disabled={uploading}
              style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: '#7a92b8', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', padding: 4 }}>
              Choose an existing photo instead
            </button>
          </>
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
          background: canSubmit ? 'linear-gradient(180deg,#38bdf8,#0284c7)' : 'rgba(255,255,255,0.06)',
          color: canSubmit ? '#06232f' : '#64748b',
          border: `1px solid ${canSubmit ? 'rgba(56,189,248,.6)' : 'rgba(255,255,255,0.12)'}`,
        }}>
        {saving ? '⏳ Submitting…' : 'Submit'}
      </button>

      {/* Sent receipts */}
      <div style={{ ...CARD, marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={LABEL}>Registrations Sent In</span>
          <button type="button" onClick={loadSent}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#7a92b8', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
            ↻ Refresh
          </button>
        </div>
        {sent === null ? (
          <div style={{ color: '#7a92b8', fontSize: 13 }}>Loading…</div>
        ) : sent.length === 0 ? (
          <div style={{ color: '#7a92b8', fontSize: 13 }}>Nothing has been sent in yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sent.slice(0, 30).map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <span style={{ fontSize: 15, flexShrink: 0 }}>✅</span>
                <span style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 15 }}>RO {r.ro || '—'}</span>
                <span style={{ marginLeft: 'auto', color: '#7a92b8', fontSize: 12, textAlign: 'right' }}>
                  {r.submittedByDisplay || r.submittedBy || ''}
                  {r.submittedAt ? ` · ${fmtShort(r.submittedAt)}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
