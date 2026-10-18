import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as github from '../utils/github';
import { uploadWarrantyMediaToS3, ensureAwsCreds } from '../utils/s3';

// ── 🚙 Rental (phone) ─────────────────────────────────────────────────────────
// Check-in / check-out pictures and videos of a loaner. Stock # (must be in
// the fleet on Service Loaner → Loaner Inventory) → customer first / last name
// → Checking In or Checking Out
// → Take Media (opens the phone camera; tap again for more) → Done — Send.
// Files go to S3 (warranty-media/loaner-media/, big videos on a signed URL);
// the session lands in data/service-loaner/media.json and shows on that
// loaner's card under 📸 Media.

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const normStock = (s) => String(s || '').trim().toUpperCase().replace(/^#/, '');
const vehicleText = (v) => [v.year, v.make, v.model].filter(Boolean).join(' ');

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 };
const LABEL = { color: '#7a92b8', fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6, display: 'block' };
const INPUT = { width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', padding: '11px 12px', fontSize: 16 };
const SMALL_BTN = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
const KIND = {
  out: { label: 'Checking Out', short: 'CHECK OUT', icon: '🔑', rgb: '251,191,36' },
  in:  { label: 'Checking In',  short: 'CHECK IN',  icon: '🅿️', rgb: '74,222,128' },
};

export default function LoanerMediaUpload({ currentUser, onBack, io }) {
  const { loadLoanerInventory, updateLoanerMedia } = io || github;
  const upload = io?.uploadWarrantyMediaToS3 || uploadWarrantyMediaToS3;
  const ensureCreds = io?.ensureAwsCreds || ensureAwsCreds;
  const [fleet, setFleet] = useState(null);        // null = loading
  const [stock, setStock] = useState('');
  const [kind, setKind] = useState('');            // 'in' | 'out'
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [files, setFiles] = useState([]);          // { id, file, preview, kind, progress }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);          // { stockNo, kind, count }
  const camRef = useRef(null);
  const libraryRef = useRef(null);

  useEffect(() => {
    loadLoanerInventory().then(d => setFleet(d.vehicles || [])).catch(() => setFleet([]));
  }, []);
  useEffect(() => () => files.forEach(f => URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const key = normStock(stock);
  // Stock # first; the fleet report's unit # works too.
  const vehicle = useMemo(() => (key && fleet ? fleet.find(v => normStock(v.stockNo) === key) || fleet.find(v => normStock(v.unitNo) === key) : null), [fleet, key]);
  const hasName = !!first.trim() && !!last.trim();
  const ready = !!vehicle && hasName && !!kind;
  const canSend = ready && files.length > 0 && !saving;

  function addFiles(e) {
    const input = e.target;
    const picked = Array.from(input.files || []);
    input.value = '';
    if (!picked.length) return;
    const ok = picked.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(jpe?g|png|heic|webp|mov|mp4)$/i.test(f.name));
    setError(ok.length < picked.length ? 'Only pictures and videos can be added.' : '');
    setFiles(prev => [...prev, ...ok.map(file => ({
      id: genId(), file, preview: URL.createObjectURL(file),
      kind: file.type.startsWith('video/') || /\.(mov|mp4)$/i.test(file.name) ? 'video' : 'image', progress: 0,
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
    if (!vehicle) { setError('Enter a stock # from the loaner fleet first.'); return; }
    if (!hasName) { setError("Enter the customer's first and last name first."); return; }
    if (!kind) { setError('Pick Checking In or Checking Out first.'); return; }
    setError('');
    ref.current?.click();
  }

  async function send() {
    if (!canSend) return;
    setSaving(true); setError('');
    const sessionId = genId();
    const folder = `loaner-media/${key.replace(/[^A-Z0-9-]+/g, '_')}/${sessionId}`;
    const uploaded = [];
    try {
      if (!(await ensureCreds())) throw new Error('Please sign in again.');
      for (const f of files) {
        const ext = (f.file.name.split('.').pop() || (f.kind === 'video' ? 'mov' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '');
        const url = await upload(`${folder}/${f.id}.${ext}`, f.file,
          p => setFiles(prev => prev.map(x => (x.id === f.id ? { ...x, progress: p } : x))));
        setFiles(prev => prev.map(x => (x.id === f.id ? { ...x, progress: 1 } : x)));
        uploaded.push({ url, name: f.file.name || `${f.kind}.${ext}`, type: f.file.type || '', kind: f.kind, size: f.file.size });
      }
    } catch (err) {
      setError(`${err.message || 'Upload failed.'} Nothing was sent — check the connection and tap Send again.`);
      setFiles(prev => prev.map(x => ({ ...x, progress: 0 })));
      setSaving(false);
      return;
    }
    try {
      const rec = {
        id: sessionId, vehicleId: vehicle.id, stockNo: vehicle.stockNo || key, vin: vehicle.vin || '', kind,
        customerFirst: first.trim().toUpperCase(), customerLast: last.trim().toUpperCase(),
        at: new Date().toISOString(), by: String(currentUser || '').toUpperCase(), files: uploaded,
      };
      await updateLoanerMedia(cur => ({ ...cur, sessions: [...cur.sessions, rec] }), `${kind === 'in' ? 'check in' : 'check out'} ${rec.stockNo}`);
      files.forEach(f => URL.revokeObjectURL(f.preview));
      setDone({ stockNo: rec.stockNo, kind, count: uploaded.length });
      setFiles([]); setStock(''); setKind(''); setFirst(''); setLast('');
    } catch (err) {
      setError(`${err.message || 'Save failed.'} Tap Send again.`);
    }
    setSaving(false);
  }

  if (done) {
    const k = KIND[done.kind];
    return (
      <div style={{ minHeight: '100vh', background: '#0d1627', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '16px 14px 40px' }}>
        <div style={{ ...CARD, borderColor: 'rgba(74,222,128,.45)', background: 'rgba(74,222,128,.08)', textAlign: 'center', padding: '28px 18px', marginTop: 30 }}>
          <div style={{ fontSize: 46, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 900, fontSize: 19, color: '#4ade80', marginBottom: 8 }}>Sent</div>
          <div style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 1.5 }}>
            {done.count} file{done.count === 1 ? '' : 's'} for <strong>stock #{done.stockNo}</strong> ({k.label.toLowerCase()}) {done.count === 1 ? 'is' : 'are'} on the Loaner Inventory page.
          </div>
        </div>
        <button onClick={() => setDone(null)} style={{ width: '100%', borderRadius: 10, padding: '15px 12px', fontSize: 16, fontWeight: 800, background: 'linear-gradient(180deg,#60a5fa,#2563eb)', color: '#fff', border: '1px solid rgba(96,165,250,.6)', cursor: 'pointer' }}>
          🚙 Another loaner
        </button>
        <button onClick={onBack} style={{ ...SMALL_BTN, width: '100%', marginTop: 10, padding: '13px 12px', fontSize: 15 }}>← Back</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1627', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '16px 14px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ color: '#93c5fd', fontWeight: 800, fontSize: 18 }}>🚙 Rental</div>
          <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 2 }}>Loaner check-in / check-out pictures &amp; videos</div>
        </div>
        <button onClick={onBack} disabled={saving} style={{ ...SMALL_BTN, padding: '8px 12px', fontWeight: 700, flexShrink: 0 }}>← Back</button>
      </div>

      {/* Step 1: stock # */}
      <div style={CARD}>
        <label style={LABEL}>1 · Stock #</label>
        <input value={stock} onChange={e => { setStock(e.target.value.toUpperCase()); setError(''); }} placeholder="e.g. LHY2445"
          autoCapitalize="characters" autoCorrect="off" disabled={saving} style={{ ...INPUT, fontWeight: 800, letterSpacing: '.04em' }} />
        {fleet === null ? <div style={{ color: '#7a92b8', fontSize: 12.5, marginTop: 6 }}>Loading the fleet…</div>
          : !key ? null
          : vehicle ? <div style={{ color: '#4ade80', fontSize: 13.5, marginTop: 6, fontWeight: 800 }}>✓ {vehicleText(vehicle) || 'Loaner'}{vehicle.vin ? ` · …${vehicle.vin.slice(-6)}` : ''}</div>
          : <div style={{ color: '#fbbf24', fontSize: 12.5, marginTop: 6, fontWeight: 600 }}>No loaner with that stock # in the fleet. Check the number — or add it on Service Loaner → Loaner Inventory.</div>}
      </div>

      {/* Step 2: customer */}
      <div style={{ ...CARD, opacity: vehicle ? 1 : 0.5 }}>
        <label style={LABEL}>2 · Customer</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={first} onChange={e => { setFirst(e.target.value); setError(''); }} placeholder="First name" autoCapitalize="words" autoComplete="off" disabled={saving} style={INPUT} />
          <input value={last} onChange={e => { setLast(e.target.value); setError(''); }} placeholder="Last name" autoCapitalize="words" autoComplete="off" disabled={saving} style={INPUT} />
        </div>
      </div>

      {/* Step 3: in or out */}
      <div style={{ ...CARD, opacity: vehicle && hasName ? 1 : 0.5 }}>
        <label style={LABEL}>3 · Is it being…</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {['out', 'in'].map(k => {
            const on = kind === k, K = KIND[k];
            return (
              <button key={k} type="button" disabled={!vehicle || !hasName || saving} onClick={() => setKind(k)}
                style={{ flex: 1, borderRadius: 10, padding: '16px 8px', fontSize: 15.5, fontWeight: 900, cursor: vehicle && hasName ? 'pointer' : 'not-allowed',
                  background: on ? `rgba(${K.rgb},.22)` : 'rgba(255,255,255,0.05)', border: `2px solid ${on ? `rgb(${K.rgb})` : 'rgba(255,255,255,0.14)'}`, color: on ? `rgb(${K.rgb})` : '#cbd5e1' }}>
                {K.icon} {K.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 4: media */}
      <div style={{ ...CARD, opacity: ready ? 1 : 0.5 }}>
        <label style={LABEL}>4 · Pictures &amp; videos</label>
        <input ref={camRef} type="file" accept="image/*,video/*" capture="environment" onChange={addFiles} style={{ display: 'none' }} />
        <input ref={libraryRef} type="file" accept="image/*,video/*" multiple onChange={addFiles} style={{ display: 'none' }} />
        <button type="button" onClick={() => pick(camRef)} disabled={saving}
          style={{ width: '100%', background: 'rgba(96,165,250,.12)', border: '1px dashed rgba(96,165,250,.6)', color: '#e2e8f0', borderRadius: 10, padding: '20px 8px', cursor: ready ? 'pointer' : 'not-allowed', fontSize: 17, fontWeight: 900 }}>
          📷 {files.length ? 'Take More Media' : 'Take Media'}
        </button>
        <button type="button" onClick={() => pick(libraryRef)} disabled={saving}
          style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: '#7a92b8', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline', cursor: ready ? 'pointer' : 'not-allowed', padding: 4 }}>
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{f.kind === 'video' ? 'Video' : 'Picture'} · {fmtSize(f.file.size)}</div>
                  {(saving || f.progress > 0) && (
                    <div style={{ marginTop: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round(f.progress * 100)}%`, height: '100%', background: f.progress >= 1 ? '#4ade80' : '#60a5fa', transition: 'width .2s' }} />
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => removeFile(f.id)} disabled={saving} title="Remove"
                  style={{ ...SMALL_BTN, color: '#f87171', borderColor: 'rgba(248,113,113,.35)', flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...CARD, borderColor: 'rgba(248,113,113,.45)', background: 'rgba(248,113,113,.1)', color: '#fca5a5', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      <button onClick={send} disabled={!canSend}
        style={{
          width: '100%', marginTop: 4, borderRadius: 10, padding: '15px 12px', fontSize: 16, fontWeight: 800, cursor: canSend ? 'pointer' : 'not-allowed',
          background: canSend ? 'linear-gradient(180deg,#4ade80,#16a34a)' : 'rgba(255,255,255,0.06)', color: canSend ? '#052e16' : '#64748b',
          border: `1px solid ${canSend ? 'rgba(74,222,128,.6)' : 'rgba(255,255,255,0.12)'}`,
        }}>
        {saving ? '⏳ Sending… keep this screen open' : `✓ Done — Send${files.length ? ` ${files.length} file${files.length === 1 ? '' : 's'}` : ''}`}
      </button>
    </div>
  );
}
