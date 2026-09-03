import React, { useRef, useState } from 'react';
import { saveAdditionalTimeRequest } from '../utils/github';
import { uploadAdditionalTimePhotoToS3, ensureAwsCreds } from '../utils/s3';

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

export default function AdditionalDiagTime({ currentUser, currentUserDisplay, onBack, onViewMine }) {
  const [ro, setRo] = useState('');
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // Two inputs on purpose: the first has capture="environment", which is what
  // makes iOS/Android open the camera straight away instead of the picker. The
  // second is the escape hatch for a photo already in the camera roll.
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);
  const idRef = useRef(genId());

  // Unlike a Techline request, the RO photo is the proof that clock time is
  // punched, so it's required here along with the reason.
  const canSubmit = ro.trim().length > 0 && hours.trim().length > 0
    && description.trim().length > 0 && !!photoUrl && !uploading && !saving;

  async function handleFile(e) {
    const file = e.target.files?.[0];
    const input = e.target;
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image.'); return; }
    setError(''); setUploading(true);
    try {
      if (!(await ensureAwsCreds())) { setError('AWS setup required — ask a manager.'); return; }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const url = await uploadAdditionalTimePhotoToS3(`diag-${idRef.current}-${Date.now()}.${ext}`, file);
      setPhotoUrl(url);
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
      await saveAdditionalTimeRequest({
        id: idRef.current,
        kind: 'diag',
        ro: ro.trim(),
        hours: hours.trim(),
        description: description.trim(),
        photoUrl,
        tech: (currentUser || '').toUpperCase(),
        techDisplay: currentUserDisplay || currentUser || '',
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        approvedAt: null,
        approvedBy: null,
      });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Submit failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    idRef.current = genId();
    setRo(''); setHours(''); setDescription(''); setPhotoUrl(''); setError(''); setDone(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1627', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '16px 14px 40px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ color: '#c084fc', fontWeight: 800, fontSize: 18 }}>Additional Diag Time</div>
          <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 2 }}>{currentUserDisplay || currentUser}</div>
        </div>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
          ← Back
        </button>
      </div>

      {done ? (
        <div style={{ ...CARD, borderColor: 'rgba(74,222,128,.45)', background: 'rgba(74,222,128,.08)' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#4ade80', marginBottom: 6 }}>Submitted for approval</div>
          <div style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.5 }}>
            Your request for <strong>{hours.trim()}</strong> hrs of diag time on RO <strong>{ro.trim()}</strong> has been sent to a manager.
            <br /><br />
            Your time is <strong>not approved yet</strong>. A manager reviews it, may adjust the hours, and approves it —
            you'll see it change to <strong style={{ color: '#4ade80' }}>Time Approved</strong> under Additional Time
            Reviewal once they do, with the hours they approved.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={reset} style={{ background: 'rgba(192,132,252,.15)', color: '#c084fc', border: '1px solid rgba(192,132,252,.4)', borderRadius: 8, padding: '10px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Submit another
            </button>
            {onViewMine && (
              <button onClick={onViewMine} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '10px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                View my submissions
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Instructions */}
          <div style={{ ...CARD, borderColor: 'rgba(192,132,252,.35)', background: 'rgba(192,132,252,.08)' }}>
            <div style={{ color: '#c084fc', fontWeight: 800, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
              How to use this
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 14, lineHeight: 1.65 }}>
              <li>Enter the <strong>repair order number</strong>.</li>
              <li>Enter the <strong>hours you're requesting</strong>.</li>
              <li>Take a <strong>picture of the repair order</strong>.</li>
              <li>Write a <strong>short description</strong> of why you need more diag time.</li>
              <li>Tap Submit.</li>
            </ol>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(192,132,252,.3)', color: '#fcd34d', fontSize: 13, fontWeight: 700, lineHeight: 1.5 }}>
              ⚠️ All time requested must have clock time punched on the repair order.
            </div>
            <div style={{ marginTop: 8, color: '#fcd34d', fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
              Submitting does not approve your time. A manager reviews every request. Your time counts only after it shows
              <strong> Time Approved</strong>.
            </div>
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

          {/* Hours requested */}
          <div style={CARD}>
            <label style={LABEL}>Diag Hours Requested <span style={{ color: '#f87171' }}>*required</span></label>
            <input
              value={hours}
              onChange={e => setHours(e.target.value)}
              placeholder="e.g. 1.5"
              inputMode="decimal"
              style={INPUT}
            />
            <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>
              How much time you're asking for. A manager can adjust this before approving.
            </div>
            {!hours.trim() && (
              <div style={{ color: '#f87171', fontSize: 12, marginTop: 6, fontWeight: 600 }}>
                Enter the hours you're requesting.
              </div>
            )}
          </div>

          {/* RO photo — camera opens straight from the tile */}
          <div style={CARD}>
            <label style={LABEL}>Picture of the Repair Order <span style={{ color: '#f87171' }}>*required</span></label>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
            <input ref={libraryRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
            {photoUrl ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <a href={photoUrl} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                  <img src={photoUrl} alt="Repair order photo"
                    style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, border: '2px solid #4ade80' }} />
                </a>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700, marginBottom: 6 }}>✓ Attached</div>
                  <button type="button" onClick={() => cameraRef.current?.click()} disabled={uploading}
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    {uploading ? 'Uploading…' : '📷 Retake'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => cameraRef.current?.click()} disabled={uploading}
                  style={{ width: '100%', background: 'rgba(192,132,252,.1)', border: '1px dashed rgba(192,132,252,.5)', color: '#e2e8f0', borderRadius: 10, padding: '22px 12px', cursor: 'pointer', fontSize: 15, fontWeight: 800 }}>
                  {uploading ? '⏳ Uploading…' : '📷 Tap to Take Photo of the RO'}
                </button>
                <div style={{ color: '#f87171', fontSize: 12, marginTop: 6, fontWeight: 600 }}>
                  The photo has to show the clock time punched on the RO.
                </div>
                <button type="button" onClick={() => libraryRef.current?.click()} disabled={uploading}
                  style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: '#7a92b8', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', padding: 4 }}>
                  Choose an existing photo instead
                </button>
              </>
            )}
          </div>

          {/* Reason */}
          <div style={CARD}>
            <label style={LABEL}>Why do you need more diag time? <span style={{ color: '#f87171' }}>*required</span></label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Short description — e.g. intermittent no-start, had to run wiring checks past the diag time allowed."
              rows={4}
              style={{ ...INPUT, resize: 'vertical', lineHeight: 1.45 }}
            />
            {!description.trim() && (
              <div style={{ color: '#f87171', fontSize: 12, marginTop: 6, fontWeight: 600 }}>
                A manager needs a reason to approve the time.
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
              background: canSubmit ? 'linear-gradient(180deg,#a855f7,#7e22ce)' : 'rgba(255,255,255,0.06)',
              color: canSubmit ? '#fff' : '#64748b',
              border: `1px solid ${canSubmit ? 'rgba(192,132,252,.6)' : 'rgba(255,255,255,0.12)'}`,
            }}>
            {saving ? '⏳ Submitting…' : 'Submit for Approval'}
          </button>

          {onViewMine && (
            <button onClick={onViewMine}
              style={{ width: '100%', marginTop: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.13)', color: '#94a3b8', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              View my submitted times
            </button>
          )}
        </>
      )}
    </div>
  );
}
