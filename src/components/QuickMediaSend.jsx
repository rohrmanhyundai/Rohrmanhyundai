import React, { useEffect, useRef, useState } from 'react';
import * as github from '../utils/github';
import { uploadWarrantyMediaToS3, ensureAwsCreds } from '../utils/s3';
import { pruneQuickMedia } from '../utils/quickMedia';

// ── 📤 Add media (phone, from the 🚙 Rental page) ────────────────────────────
// Not tied to a loaner or customer: type a note, take as many pictures / videos
// as needed, Send. It lands on Service Loaner → 📸 Media on the website, where
// it's kept 72 hours (utils/quickMedia). Files go to S3 under
// warranty-media/quick-media/<upload id>/.

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 };
const LABEL = { color: '#7a92b8', fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6, display: 'block' };
const SMALL_BTN = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 };

export default function QuickMediaSend({ currentUser, onBack, io }) {
  const { updateQuickMedia } = io || github;
  const upload = io?.uploadWarrantyMediaToS3 || uploadWarrantyMediaToS3;
  const ensureCreds = io?.ensureAwsCreds || ensureAwsCreds;
  const [note, setNote] = useState('');
  const [files, setFiles] = useState([]);   // { id, file, preview, kind, progress }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(0);      // files sent → the "Sent" screen
  const camRef = useRef(null);
  const libRef = useRef(null);
  useEffect(() => () => files.forEach(f => URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    const ok = picked.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(jpe?g|png|heic|webp|mov|mp4)$/i.test(f.name));
    setError(ok.length < picked.length ? 'Only pictures and videos can be added.' : '');
    setFiles(prev => [...prev, ...ok.map(file => ({
      id: genId(), file, preview: URL.createObjectURL(file), progress: 0,
      kind: file.type.startsWith('video/') || /\.(mov|mp4)$/i.test(file.name) ? 'video' : 'image',
    }))]);
  }
  const removeFile = (id) => setFiles(prev => { const f = prev.find(x => x.id === id); if (f) URL.revokeObjectURL(f.preview); return prev.filter(x => x.id !== id); });

  async function send() {
    if (!files.length || saving) return;
    setSaving(true); setError('');
    const id = genId();
    const uploaded = [];
    try {
      if (!(await ensureCreds())) throw new Error('Please sign in again.');
      for (const f of files) {
        const ext = (f.file.name.split('.').pop() || (f.kind === 'video' ? 'mov' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '');
        const url = await upload(`quick-media/${id}/${f.id}.${ext}`, f.file, p => setFiles(prev => prev.map(x => (x.id === f.id ? { ...x, progress: p } : x))));
        setFiles(prev => prev.map(x => (x.id === f.id ? { ...x, progress: 1 } : x)));
        uploaded.push({ url, name: f.file.name || `${f.kind}.${ext}`, type: f.file.type || '', kind: f.kind, size: f.file.size });
      }
      const rec = { id, note: note.trim(), by: String(currentUser || '').toUpperCase(), at: new Date().toISOString(), files: uploaded };
      await updateQuickMedia(cur => ({ ...cur, items: [...cur.items, rec] }), `add ${uploaded.length}`);
      pruneQuickMedia(io).catch(() => {});
      files.forEach(f => URL.revokeObjectURL(f.preview));
      setFiles([]); setNote('');
      setSent(uploaded.length);
    } catch (err) {
      setError(`${err.message || 'Upload failed.'} Nothing was sent — check the connection and tap Send again.`);
      setFiles(prev => prev.map(x => ({ ...x, progress: 0 })));
    }
    setSaving(false);
  }

  const page = { minHeight: '100vh', background: '#0d1627', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '16px 14px 40px' };
  if (sent) return (
    <div style={page}>
      <div style={{ ...CARD, borderColor: 'rgba(74,222,128,.45)', background: 'rgba(74,222,128,.08)', textAlign: 'center', padding: '28px 18px', marginTop: 30 }}>
        <div style={{ fontSize: 46, marginBottom: 8 }}>✅</div>
        <div style={{ fontWeight: 900, fontSize: 19, color: '#4ade80', marginBottom: 8 }}>Sent</div>
        <div style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 1.5 }}>
          {sent} file{sent === 1 ? '' : 's'} {sent === 1 ? 'is' : 'are'} on Service Loaner → 📸 Media for the next 72 hours.
        </div>
      </div>
      <button onClick={() => setSent(0)} style={{ width: '100%', borderRadius: 10, padding: '15px 12px', fontSize: 16, fontWeight: 800, background: 'linear-gradient(180deg,#60a5fa,#2563eb)', color: '#fff', border: '1px solid rgba(96,165,250,.6)', cursor: 'pointer' }}>📤 Send more</button>
      <button onClick={onBack} style={{ ...SMALL_BTN, width: '100%', marginTop: 10, padding: '13px 12px', fontSize: 15 }}>← Back to Rental</button>
    </div>
  );

  return (
    <div style={page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ color: '#93c5fd', fontWeight: 800, fontSize: 18 }}>📤 Add media</div>
          <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 2 }}>Goes to Service Loaner → 📸 Media · kept 72 hours</div>
        </div>
        <button onClick={onBack} disabled={saving} style={{ ...SMALL_BTN, flexShrink: 0 }}>← Back</button>
      </div>

      <div style={CARD}>
        <label style={LABEL}>1 · Notes</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} disabled={saving} rows={3} placeholder="What is this? e.g. LHY2595 windshield chip, customer's car scratch…"
          style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', padding: '11px 12px', fontSize: 16, fontFamily: 'inherit', resize: 'vertical' }} />
      </div>

      <div style={CARD}>
        <label style={LABEL}>2 · Pictures &amp; videos</label>
        <input ref={camRef} type="file" accept="image/*,video/*" capture="environment" onChange={addFiles} style={{ display: 'none' }} />
        <input ref={libRef} type="file" accept="image/*,video/*" multiple onChange={addFiles} style={{ display: 'none' }} />
        <button type="button" onClick={() => camRef.current?.click()} disabled={saving}
          style={{ width: '100%', background: 'rgba(96,165,250,.12)', border: '1px dashed rgba(96,165,250,.6)', color: '#e2e8f0', borderRadius: 10, padding: '20px 6px', cursor: 'pointer', fontSize: 18, fontWeight: 900 }}>
          📷 {files.length ? 'Take more' : 'Open camera'}
        </button>
        <button type="button" onClick={() => libRef.current?.click()} disabled={saving}
          style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 'none', color: '#93c5fd', textDecoration: 'underline', fontSize: 13.5, cursor: 'pointer' }}>
          Choose pictures or videos already on this phone
        </button>
        {files.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
            {files.map(f => (
              <div key={f.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', background: '#000', border: '1px solid rgba(255,255,255,.15)' }}>
                {f.kind === 'video'
                  ? <video src={f.preview} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <img src={f.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                {f.kind === 'video' && <span style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 14 }}>🎬</span>}
                {saving
                  ? <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, background: 'rgba(0,0,0,.5)' }}><div style={{ width: `${Math.round(f.progress * 100)}%`, height: '100%', background: '#4ade80' }} /></div>
                  : <button onClick={() => removeFile(f.id)} style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 999, border: 0, background: '#ef4444', color: '#fff', fontWeight: 900, cursor: 'pointer', lineHeight: '24px', padding: 0 }}>×</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div style={{ color: '#fca5a5', fontSize: 14, fontWeight: 700, margin: '0 2px 12px' }}>{error}</div>}
      <button onClick={send} disabled={!files.length || saving}
        style={{ width: '100%', borderRadius: 12, padding: '17px 12px', fontSize: 17, fontWeight: 900, cursor: files.length && !saving ? 'pointer' : 'default',
          background: files.length ? 'linear-gradient(180deg,#4ade80,#16a34a)' : 'rgba(255,255,255,0.05)', color: files.length ? '#052e16' : '#64748b', border: `1px solid ${files.length ? 'rgba(74,222,128,.7)' : 'rgba(255,255,255,.12)'}` }}>
        {saving ? '⏳ Sending…' : files.length ? `✓ Send ${files.length} file${files.length === 1 ? '' : 's'}` : '✓ Send'}
      </button>
    </div>
  );
}
