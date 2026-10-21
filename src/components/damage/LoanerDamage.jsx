import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as github from '../../utils/github';
import { uploadLoanerMaintenancePhotoToS3 } from '../../utils/s3';
import { createCarScene, CAR_PARTS, PART_LABEL } from './carScene';

// ── Report Damage (Loaner Inventory → 🚨 Report damage) ──────────────────────
// Full-screen 3D loaner: drag to spin it, click a panel to report damage on it
// (type + description + photos). Damaged panels glow red until someone marks
// the damage Repaired; repaired reports move to the car's history. Stored in
// data/service-loaner/damage.json, photos in S3 beside the maintenance ones.
// Loaded lazily so three.js only downloads when this page opens.

const TYPES = ['Scratch', 'Dent', 'Chip', 'Crack', 'Scuff', 'Missing', 'Other'];
const MAX_PHOTOS = 6;
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 10, padding: '8px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' });
const fmtWhen = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
const isImg = (p) => /^image\//.test(p.type || '') || /\.(jpe?g|png|gif|webp|heic)$/i.test(p.url || '');

export default function LoanerDamage({ vehicle, currentUser, io, onClose, onChanged }) {
  const { loadLoanerDamage, updateLoanerDamage } = io || github;
  const uploadPhoto = io?.uploadLoanerMaintenancePhotoToS3 || uploadLoanerMaintenancePhotoToS3;
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const fileRef = useRef(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState(null);         // { id, x, y }
  const [part, setPart] = useState(null);           // selected part id
  const [type, setType] = useState('');
  const [desc, setDesc] = useState('');
  const [files, setFiles] = useState([]);           // [{ file, url }]
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [error3d, setError3d] = useState('');

  const mine = useMemo(() => reports.filter(r => r.vehicleId === vehicle.id || (r.vin && r.vin === vehicle.vin)), [reports, vehicle]);
  const open = mine.filter(r => r.status !== 'repaired');
  const repaired = mine.filter(r => r.status === 'repaired').sort((a, b) => String(b.repairedAt).localeCompare(String(a.repairedAt)));
  const damagedIds = useMemo(() => [...new Set(open.map(r => r.part))], [open]);

  useEffect(() => {
    let alive = true;
    loadLoanerDamage().then(d => { if (alive) { setReports(d.reports || []); setLoading(false); } }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the 3D scene once.
  useEffect(() => {
    if (!mountRef.current) return undefined;
    let handle;
    try {
      handle = createCarScene(mountRef.current, {
        onHover: (id, e) => setHover(id && e ? { id, x: e.clientX, y: e.clientY } : null),
        onPick: (id) => pick(id),
      });
    } catch (e) {
      setError3d('3D view could not start on this device (WebGL is off). Pick the part from the list instead.');
      return undefined;
    }
    sceneRef.current = handle;
    return () => { handle.dispose(); sceneRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { sceneRef.current && sceneRef.current.setDamaged(damagedIds); }, [damagedIds]);
  useEffect(() => { sceneRef.current && sceneRef.current.setSelected(part); }, [part]);
  useEffect(() => () => files.forEach(f => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) { if (part) setPart(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [part, busy, onClose]);

  function pick(id) {
    setPart(id);
    setType(''); setDesc(''); setStatus('');
    setFiles(cur => { cur.forEach(f => URL.revokeObjectURL(f.url)); return []; });
  }
  function addFiles(list) {
    const all = Array.from(list || []);
    if (fileRef.current) fileRef.current.value = '';
    const picked = all.filter(f => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|heic|webp|mov|mp4)$/i.test(f.name));
    setFiles(cur => [...cur, ...picked.map(file => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_PHOTOS));
  }

  async function save() {
    if (!part || !type || busy) return;
    setBusy(true); setStatus(files.length ? `Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…` : 'Saving…');
    try {
      const photos = [];
      for (const f of files) photos.push({ url: await uploadPhoto(f.file), name: f.file.name || 'photo', type: f.file.type || '' });
      const rec = {
        id: `ld-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        vehicleId: vehicle.id, vin: vehicle.vin || '', stockNo: vehicle.stockNo || '',
        part, partLabel: PART_LABEL[part] || part, type, description: desc.trim(), photos,
        status: 'open', reportedAt: new Date().toISOString(), reportedBy: currentUser,
      };
      setStatus('Saving…');
      const next = await updateLoanerDamage(cur => ({ ...cur, reports: [...cur.reports, rec] }), `${rec.stockNo || rec.vin} ${rec.partLabel} ${type}`);
      setReports(next.reports);
      onChanged && onChanged(next.reports);
      files.forEach(f => URL.revokeObjectURL(f.url));
      setFiles([]); setType(''); setDesc('');
      setPart(null);   // deselect so the panel shows red straight away
      setStatus(`✓ ${type} on the ${rec.partLabel.toLowerCase()} saved.`);
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }

  async function markRepaired(r) {
    if (!window.confirm(`Mark the ${r.type.toLowerCase()} on the ${r.partLabel.toLowerCase()} as repaired?`)) return;
    setBusy(true); setStatus('Saving…');
    try {
      const next = await updateLoanerDamage(cur => ({ ...cur, reports: cur.reports.map(x => x.id === r.id ? { ...x, status: 'repaired', repairedAt: new Date().toISOString(), repairedBy: currentUser } : x) }), `repaired ${r.stockNo || r.vin} ${r.partLabel}`);
      setReports(next.reports);
      onChanged && onChanged(next.reports);
      setStatus(`✓ ${r.partLabel} marked repaired.`);
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }

  const partOpen = part ? open.filter(r => r.part === part) : [];
  const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');

  const reportCard = (r, done) => (
    <div key={r.id} style={{ borderRadius: 12, padding: '10px 12px', background: done ? 'rgba(255,255,255,.03)' : 'rgba(239,68,68,.08)', border: `1px solid ${done ? 'rgba(148,163,184,.2)' : 'rgba(239,68,68,.4)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => { setPart(r.part); setType(''); setDesc(''); }} style={{ all: 'unset', cursor: 'pointer', fontWeight: 900, fontSize: 13.5, color: done ? '#cbd5e1' : '#fecaca', flex: 1 }}>
          {r.partLabel}
        </button>
        <span style={{ fontSize: 11, fontWeight: 900, padding: '2px 8px', borderRadius: 999, color: done ? '#052e16' : '#450a0a', background: done ? '#86efac' : '#fca5a5' }}>{done ? 'REPAIRED' : r.type.toUpperCase()}</span>
      </div>
      {r.description && <div style={{ fontSize: 12.5, color: '#e2e8f0', marginTop: 4, lineHeight: 1.4 }}>{r.description}</div>}
      {(r.photos || []).length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {r.photos.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" title={p.name}>
              {isImg(p) ? <img src={p.url} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 7, border: '1px solid rgba(148,163,184,.3)' }} />
                : <span style={{ display: 'inline-flex', width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 7, border: '1px solid rgba(148,163,184,.3)' }}>🎬</span>}
            </a>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11.5, color: '#94a3b8' }}>
        <span style={{ flex: 1 }}>{done ? `${done ? r.type + ' · ' : ''}repaired by ${r.repairedBy} ${fmtWhen(r.repairedAt)}` : `${r.reportedBy} · ${fmtWhen(r.reportedAt)}`}</span>
        {!done && <button disabled={busy} onClick={() => markRepaired(r)} style={{ ...btn('74,222,128'), padding: '4px 10px', fontSize: 11.5 }}>✓ Repaired</button>}
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', flexDirection: 'column', color: '#e2e8f0', fontFamily: 'inherit',
      background: 'radial-gradient(1200px 700px at 35% 30%, #13233f 0%, #0a1222 55%, #050913 100%)' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderBottom: '1px solid rgba(148,163,184,.15)', background: 'rgba(2,6,23,.55)', backdropFilter: 'blur(8px)' }}>
        <button onClick={onClose} disabled={busy} style={{ ...btn('148,163,184', false), whiteSpace: 'nowrap', flexShrink: 0 }}>← Fleet</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 900, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🚨 {vehicle.stockNo ? `#${vehicle.stockNo}` : vehicle.vin} <span style={{ fontSize: 13, fontWeight: 800, color: '#fca5a5' }}>Report damage</span></div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}{vehicle.mileage ? ` · ${Number(vehicle.mileage).toLocaleString()} mi` : ''}</div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 900, padding: '6px 12px', borderRadius: 999, color: open.length ? '#fecaca' : '#bbf7d0', background: open.length ? 'rgba(239,68,68,.15)' : 'rgba(74,222,128,.12)', border: `1px solid ${open.length ? 'rgba(239,68,68,.5)' : 'rgba(74,222,128,.45)'}` }}>
          {open.length ? `⚠ ${open.length} open damage${open.length === 1 ? '' : 's'}` : '✓ No open damage'}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', overflowY: 'auto' }}>
        {/* 3D stage */}
        <div style={{ flex: '1 1 560px', minHeight: 380, position: 'relative' }}>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
          {error3d && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, textAlign: 'center', color: '#fca5a5', fontWeight: 800 }}>{error3d}</div>}
          {/* View buttons */}
          <div style={{ position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)', display: 'flex', gap: 6, padding: 6, borderRadius: 14, background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.2)', backdropFilter: 'blur(8px)' }}>
            {[['front', 'Front'], ['left', 'Left'], ['rear', 'Rear'], ['right', 'Right'], ['top', 'Top'], ['corner', '3D']].map(([k, l]) => (
              <button key={k} onClick={() => sceneRef.current && sceneRef.current.viewFrom(k)} style={{ ...btn('56,189,248', false), padding: '7px 12px', fontSize: 12.5 }}>{l}</button>
            ))}
          </div>
          <div style={{ position: 'absolute', left: 18, top: 16, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, pointerEvents: 'none' }}>
            🖱 Drag to spin · scroll / pinch to zoom<br />👆 Click a panel to report damage
            <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#ef4444', boxShadow: '0 0 8px #ef4444', marginRight: 5 }} />damaged</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#22d3ee', marginRight: 5 }} />selected</span>
            </div>
          </div>
          {hover && (
            <div style={{ position: 'fixed', left: hover.x + 14, top: hover.y + 12, pointerEvents: 'none', zIndex: 5, padding: '5px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 800, background: 'rgba(2,6,23,.92)', border: `1px solid ${damagedIds.includes(hover.id) ? 'rgba(239,68,68,.6)' : 'rgba(56,189,248,.5)'}`, color: damagedIds.includes(hover.id) ? '#fecaca' : '#e0f2fe', whiteSpace: 'nowrap' }}>
              {PART_LABEL[hover.id]}{damagedIds.includes(hover.id) ? ` · ${open.filter(r => r.part === hover.id).map(r => r.type).join(', ')}` : ''}
            </div>
          )}
        </div>

        {/* Side panel */}
        <div style={{ flex: '0 1 400px', minWidth: 300, maxHeight: '100%', overflowY: 'auto', padding: '18px 20px', background: 'rgba(2,6,23,.55)', borderLeft: '1px solid rgba(148,163,184,.15)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {part ? (
            <div style={{ borderRadius: 16, padding: 16, background: 'rgba(15,23,42,.85)', border: '1px solid rgba(34,211,238,.45)', boxShadow: '0 10px 30px -12px rgba(34,211,238,.45)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, fontSize: 16, fontWeight: 900, color: '#a5f3fc' }}>{PART_LABEL[part]}</div>
                <button disabled={busy} onClick={() => setPart(null)} style={{ ...btn('148,163,184', false), padding: '4px 9px' }}>✕</button>
              </div>
              {partOpen.length > 0 && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4, fontWeight: 800 }}>Already reported here: {partOpen.map(r => r.type).join(', ')}</div>}
              <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', margin: '12px 0 6px' }}>What happened?</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {TYPES.map(t => <button key={t} disabled={busy} onClick={() => setType(t)} style={{ ...btn('248,113,113', type === t), padding: '7px 12px' }}>{type === t ? '● ' : ''}{t}</button>)}
              </div>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} disabled={busy} rows={3} placeholder="Describe it — e.g. 4 inch scratch above the reflector"
                style={{ marginTop: 10, width: '100%', boxSizing: 'border-box', background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', fontSize: 14, fontFamily: 'inherit', lineHeight: 1.45, resize: 'vertical', outline: 'none' }} />
              <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', margin: '10px 0 6px' }}>Photos <span style={{ color: '#fbbf24' }}>· recommended</span></div>
              <input ref={fileRef} type="file" accept="image/*,video/*" multiple capture="environment" style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {files.map((f, i) => (
                  <div key={f.url} style={{ position: 'relative' }}>
                    {/^video\//.test(f.file.type)
                      ? <span style={{ display: 'inline-flex', width: 60, height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: '1px solid rgba(148,163,184,.3)', fontSize: 22 }}>🎬</span>
                      : <img src={f.url} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 9, border: '1px solid rgba(148,163,184,.3)' }} />}
                    <button disabled={busy} onClick={() => setFiles(cur => { URL.revokeObjectURL(cur[i].url); return cur.filter((_, j) => j !== i); })}
                      style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: 999, border: 0, background: '#ef4444', color: '#fff', fontWeight: 900, cursor: 'pointer', lineHeight: '20px', padding: 0 }}>×</button>
                  </div>
                ))}
                {files.length < MAX_PHOTOS && <button disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} style={btn('196,181,253')}>📷 Add photos</button>}
              </div>
              <button disabled={busy || !type} onClick={save}
                style={{ ...btn('248,113,113'), width: '100%', marginTop: 14, padding: '11px 0', fontSize: 14.5, background: type ? 'linear-gradient(180deg,rgba(248,113,113,.35),rgba(220,38,38,.22))' : undefined, opacity: type ? 1 : 0.6 }}>
                {busy ? (status || 'Saving…') : type ? `🚨 Report ${type.toLowerCase()}` : 'Pick what happened first'}
              </button>
            </div>
          ) : (
            <div style={{ borderRadius: 16, padding: '18px 16px', background: 'rgba(15,23,42,.6)', border: '1px dashed rgba(148,163,184,.35)', textAlign: 'center', color: '#94a3b8', fontSize: 13.5, lineHeight: 1.55 }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>👆</div>
              Click a panel on the car to report damage there.
              <select value="" onChange={e => e.target.value && pick(e.target.value)} style={{ marginTop: 12, width: '100%', background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '8px 10px', fontFamily: 'inherit', colorScheme: 'dark' }}>
                <option value="">…or pick a part from the list</option>
                {CAR_PARTS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
              </select>
            </div>
          )}
          {status && !busy && <div style={{ fontSize: 13, fontWeight: 800, color: status.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{status}</div>}

          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '.08em', color: '#fca5a5', marginBottom: 8 }}>OPEN DAMAGE · {open.length}</div>
            {loading ? <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div>
              : open.length === 0 ? <div style={{ color: '#64748b', fontSize: 13 }}>Nothing reported. Clean car. ✨</div>
              : <div style={{ display: 'grid', gap: 8 }}>{open.map(r => reportCard(r, false))}</div>}
          </div>
          {repaired.length > 0 && (
            <div>
              <button onClick={() => setShowHistory(v => !v)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 900, letterSpacing: '.08em', color: '#86efac' }}>
                {showHistory ? '▾' : '▸'} REPAIRED HISTORY · {repaired.length}
              </button>
              {showHistory && <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>{repaired.map(r => reportCard(r, true))}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
