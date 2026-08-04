import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadTireWarrantyIndex, saveTireWarrantyClaim, removeTireWarrantyClaim } from '../utils/github';
import { uploadTirePhotoToS3, ensureAwsCreds } from '../utils/s3';

const accent = '#fbbf24'; // amber — tire theme

// ── Claim shape ───────────────────────────────────────────────────────────────
// The four wheel positions. `front` drives the "FRONT" marker on the diagram.
export const WHEELS = [
  { key: 'LF', label: 'Left Front',  front: true  },
  { key: 'RF', label: 'Right Front', front: true  },
  { key: 'LR', label: 'Left Rear',   front: false },
  { key: 'RR', label: 'Right Rear',  front: false },
];

// Photo slots required for tire damage vs. rim damage.
export const TIRE_SLOTS = [
  { key: 'tireDamage', label: 'Tire Damage' },
  { key: 'dot',        label: 'DOT Number' },
  { key: 'size',       label: 'Tire Size' },
  { key: 'brand',      label: 'Tire Brand' },
  { key: 'tireFull',   label: 'Full Tire' },
];
export const RIM_SLOTS = [
  { key: 'rimDamage', label: 'Rim Damage' },
  { key: 'rimFull',   label: 'Full Rim' },
];

// Which photo slots a wheel needs, based on the damage flagged on it.
export function wheelPhotoSlots(w) {
  if (!w) return [];
  const slots = [];
  if (w.tire) slots.push(...TIRE_SLOTS);
  if (w.rim)  slots.push(...RIM_SLOTS);
  return slots;
}

// Wheels that have any damage flagged, in canonical order.
export function flaggedWheels(form) {
  return WHEELS.filter(w => {
    const d = form.wheels?.[w.key];
    return d && (d.tire || d.rim);
  });
}

function damageLabel(d) {
  if (!d) return '';
  if (d.tire && d.rim) return 'Tire & Rim';
  if (d.tire) return 'Tire';
  if (d.rim) return 'Rim';
  return '';
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const emptyForm = () => ({
  id: genId(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: '',
  customerName: '',
  repairOrder: '',
  repairOrderPhoto: '',
  wheels: {
    LF: { tire: false, rim: false },
    RF: { tire: false, rim: false },
    LR: { tire: false, rim: false },
    RR: { tire: false, rim: false },
  },
  photos: { LF: {}, RF: {}, LR: {}, RR: {} },
});

// True once every required field + photo is present.
export function claimComplete(form) {
  if (!String(form.customerName || '').trim()) return false;
  if (!String(form.repairOrder || '').trim()) return false;
  if (!form.repairOrderPhoto) return false;
  const flagged = flaggedWheels(form);
  if (flagged.length === 0) return false;
  return flagged.every(w =>
    wheelPhotoSlots(form.wheels[w.key]).every(s => !!form.photos?.[w.key]?.[s.key]));
}

// Count of (captured, required) photos across all flagged wheels.
export function photoProgress(form) {
  let have = 0, need = 0;
  flaggedWheels(form).forEach(w => {
    wheelPhotoSlots(form.wheels[w.key]).forEach(s => {
      need += 1;
      if (form.photos?.[w.key]?.[s.key]) have += 1;
    });
  });
  return { have, need };
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const labelSt = {
  display: 'block', fontSize: 11, fontWeight: 700,
  color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
};
const inpSt = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 10, color: '#e2e8f0', padding: '12px 14px', fontSize: 16, outline: 'none',
};
const primaryBtn = (enabled) => ({
  width: '100%', boxSizing: 'border-box',
  background: enabled ? 'linear-gradient(135deg,rgba(251,191,36,0.9),rgba(245,158,11,0.85))' : 'rgba(255,255,255,0.06)',
  border: `1px solid ${enabled ? accent : 'rgba(255,255,255,0.12)'}`,
  color: enabled ? '#1a1205' : '#64748b',
  borderRadius: 12, padding: '15px 20px', fontSize: 16, fontWeight: 800,
  cursor: enabled ? 'pointer' : 'not-allowed', transition: 'background .2s, box-shadow .2s',
  boxShadow: enabled ? '0 4px 18px rgba(251,191,36,0.35)' : 'none',
});

// ── Camera / photo capture button ─────────────────────────────────────────────
// On phones, accept="image/*" + capture="environment" opens the rear camera
// directly. The captured image uploads to S3 immediately and stores its URL.
function CameraButton({ label, value, onChange, claimId, slotKey, compact }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image.'); return; }
    setError('');
    setUploading(true);
    try {
      if (!(await ensureAwsCreds())) { setError('AWS setup required.'); return; }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const filename = `${claimId}-${slotKey}-${Date.now()}.${ext}`;
      const url = await uploadTirePhotoToS3(filename, file);
      onChange(url);
    } catch (err) {
      setError('Upload failed: ' + (err.message || err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const thumb = compact ? 64 : 84;

  return (
    <div style={{ marginBottom: compact ? 0 : 14 }}>
      {!compact && <label style={labelSt}>{label}</label>}
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        onChange={handleFile} style={{ display: 'none' }} />
      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href={value} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
            <img src={value} alt={label}
              style={{ width: thumb, height: thumb, objectFit: 'cover', borderRadius: 10, border: `2px solid #4ade80` }} />
          </a>
          <div style={{ flex: 1, minWidth: 0 }}>
            {compact && <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>{label}</div>}
            <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700, marginBottom: 6 }}>✓ Uploaded</div>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              {uploading ? 'Uploading…' : '📷 Retake'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'rgba(251,191,36,0.08)', border: `1.5px dashed ${accent}66`, color: accent,
            borderRadius: 12, padding: compact ? '16px 12px' : '22px 12px', cursor: uploading ? 'wait' : 'pointer', fontSize: 15, fontWeight: 700 }}>
          {uploading ? 'Uploading…' : <>📷 {compact ? label : 'Take Photo'}</>}
        </button>
      )}
      {error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

// ── Step 1: Customer + Repair Order ───────────────────────────────────────────
function StepStart({ form, set, onNext }) {
  const ready = String(form.customerName || '').trim() && String(form.repairOrder || '').trim() && form.repairOrderPhoto;
  return (
    <div style={{ padding: '20px 18px 32px' }}>
      <StepHeader step={1} total={3} title="Customer & Repair Order" />
      <div style={{ marginBottom: 16 }}>
        <label style={labelSt}>Customer Name</label>
        <input value={form.customerName} onChange={e => set('customerName', e.target.value)}
          placeholder="First and last name" style={inpSt} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelSt}>Repair Order Number</label>
        <input value={form.repairOrder} onChange={e => set('repairOrder', e.target.value)}
          placeholder="RO #" inputMode="numeric" style={inpSt} />
      </div>
      <CameraButton label="Photo of Repair Order" value={form.repairOrderPhoto}
        onChange={v => set('repairOrderPhoto', v)} claimId={form.id} slotKey="repairorder" />
      <div style={{ marginTop: 24 }}>
        <button onClick={onNext} disabled={!ready} style={primaryBtn(ready)}>Next → Mark Damage</button>
      </div>
      {!ready && <div style={{ textAlign: 'center', color: '#64748b', fontSize: 12, marginTop: 10 }}>
        Enter the name, RO number, and a photo of the repair order to continue.
      </div>}
    </div>
  );
}

// ── Step 2: Damage map ────────────────────────────────────────────────────────
function Wheel({ wheelKey, damage, onTap }) {
  const active = damage && (damage.tire || damage.rim);
  const both = damage?.tire && damage?.rim;
  const bg = both ? 'linear-gradient(135deg,#fbbf24,#60a5fa)'
    : damage?.tire ? accent
    : damage?.rim ? '#60a5fa'
    : 'rgba(255,255,255,0.09)';
  return (
    <button onClick={() => onTap(wheelKey)}
      style={{
        width: 72, height: 104, borderRadius: 16,
        background: bg,
        border: active ? '2px solid #fff' : '2px solid rgba(255,255,255,0.18)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', color: active ? '#0d1627' : '#94a3b8', fontWeight: 800,
        boxShadow: active ? '0 0 16px rgba(251,191,36,0.5)' : 'none',
      }}>
      <span style={{ fontSize: 22 }}>🛞</span>
      <span style={{ fontSize: 11, marginTop: 2 }}>{wheelKey}</span>
      {active && <span style={{ fontSize: 9, fontWeight: 700, marginTop: 2, textAlign: 'center', lineHeight: 1.1 }}>{damageLabel(damage)}</span>}
    </button>
  );
}

function DamageChooser({ wheelKey, damage, onSet, onClose }) {
  const label = WHEELS.find(w => w.key === wheelKey)?.label || wheelKey;
  const opt = (title, sub, val) => {
    const isOn = damage?.tire === val.tire && damage?.rim === val.rim;
    return (
      <button onClick={() => { onSet(val); onClose(); }}
        style={{ width: '100%', textAlign: 'left', background: isOn ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${isOn ? accent : 'rgba(255,255,255,0.12)'}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10, cursor: 'pointer' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: isOn ? accent : '#e2e8f0' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{sub}</div>
      </button>
    );
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: '#111c30', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '22px 18px 28px', borderTop: `2px solid ${accent}55` }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>{label} Wheel</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 18 }}>What kind of damage is on this wheel?</div>
        {opt('Tire Damage', '5 photos: damage, DOT#, size, brand, full tire', { tire: true, rim: false })}
        {opt('Rim Damage', '2 photos: damage, full rim', { tire: false, rim: true })}
        {opt('Tire & Rim', '7 photos: 5 tire + 2 rim', { tire: true, rim: true })}
        {damage && (damage.tire || damage.rim) && (
          <button onClick={() => { onSet({ tire: false, rim: false }); onClose(); }}
            style={{ width: '100%', background: 'transparent', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 12, padding: '12px', cursor: 'pointer', fontWeight: 700, marginTop: 4 }}>
            Clear this wheel
          </button>
        )}
      </div>
    </div>
  );
}

function StepMap({ form, setWheel, onNext, onBack }) {
  const [chooser, setChooser] = useState(null);
  const anyFlagged = flaggedWheels(form).length > 0;
  const wheelFor = k => form.wheels?.[k] || { tire: false, rim: false };
  return (
    <div style={{ padding: '20px 18px 32px' }}>
      <StepHeader step={2} total={3} title="Mark the Damage" />
      <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
        Tap each wheel that has damage.
      </div>

      {/* Top-down car diagram */}
      <div style={{ position: 'relative', maxWidth: 260, margin: '0 auto 8px', padding: '10px 0' }}>
        <div style={{ position: 'absolute', top: 2, left: 0, right: 0, textAlign: 'center', fontSize: 11, fontWeight: 800, color: '#64748b', letterSpacing: 2 }}>▲ FRONT</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Wheel wheelKey="LF" damage={wheelFor('LF')} onTap={setChooser} />
          <div style={{ flex: 1, height: 190, margin: '18px 4px 0', borderRadius: 26, background: 'linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 30 }}>🚗</div>
          <Wheel wheelKey="RF" damage={wheelFor('RF')} onTap={setChooser} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: -70 }}>
          <Wheel wheelKey="LR" damage={wheelFor('LR')} onTap={setChooser} />
          <Wheel wheelKey="RR" damage={wheelFor('RR')} onTap={setChooser} />
        </div>
      </div>

      {/* Summary of selections */}
      <div style={{ marginTop: 28, marginBottom: 8 }}>
        {flaggedWheels(form).length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>No wheels marked yet.</div>
        ) : flaggedWheels(form).map(w => (
          <div key={w.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 8 }}>
            <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{w.label}</span>
            <span style={{ color: accent, fontWeight: 700, fontSize: 13 }}>{damageLabel(form.wheels[w.key])} · {wheelPhotoSlots(form.wheels[w.key]).length} photos</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
        <button onClick={onBack} style={{ flex: '0 0 auto', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#cbd5e1', borderRadius: 12, padding: '15px 20px', cursor: 'pointer', fontWeight: 700 }}>← Back</button>
        <button onClick={onNext} disabled={!anyFlagged} style={primaryBtn(anyFlagged)}>Next → Photos</button>
      </div>

      {chooser && (
        <DamageChooser wheelKey={chooser} damage={wheelFor(chooser)}
          onSet={val => setWheel(chooser, val)} onClose={() => setChooser(null)} />
      )}
    </div>
  );
}

// ── Step 3: Photos per wheel ──────────────────────────────────────────────────
function StepPhotos({ form, setPhoto, onSave, onBack, saving, saveError }) {
  const flagged = flaggedWheels(form);
  const { have, need } = photoProgress(form);
  const complete = claimComplete(form);
  return (
    <div style={{ padding: '20px 18px 40px' }}>
      <StepHeader step={3} total={3} title="Take the Photos" />
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0d1627', padding: '4px 0 12px', marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 700 }}>Photos captured</span>
          <span style={{ color: have === need ? '#4ade80' : accent, fontSize: 14, fontWeight: 800 }}>{have} / {need}</span>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${need ? (have / need) * 100 : 0}%`, height: '100%', background: have === need ? '#4ade80' : accent, transition: 'width .3s' }} />
        </div>
      </div>

      {flagged.map(w => {
        const slots = wheelPhotoSlots(form.wheels[w.key]);
        const wHave = slots.filter(s => form.photos?.[w.key]?.[s.key]).length;
        return (
          <div key={w.key} style={{ marginBottom: 22, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: accent }}>{w.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: wHave === slots.length ? '#4ade80' : '#94a3b8' }}>
                {damageLabel(form.wheels[w.key])} · {wHave}/{slots.length}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {slots.map(s => (
                <CameraButton key={s.key} compact label={s.label}
                  value={form.photos?.[w.key]?.[s.key] || ''}
                  onChange={url => setPhoto(w.key, s.key, url)}
                  claimId={form.id} slotKey={`${w.key}-${s.key}`} />
              ))}
            </div>
          </div>
        );
      })}

      {saveError && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{saveError}</div>}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onBack} disabled={saving} style={{ flex: '0 0 auto', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#cbd5e1', borderRadius: 12, padding: '15px 20px', cursor: 'pointer', fontWeight: 700 }}>← Back</button>
        <button onClick={onSave} disabled={!complete || saving} style={primaryBtn(complete && !saving)}>
          {saving ? 'Saving…' : complete ? '✓ Save Claim' : `Save Claim (${have}/${need})`}
        </button>
      </div>
    </div>
  );
}

function StepHeader({ step, total, title }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i < step ? accent : 'rgba(255,255,255,0.12)' }} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>STEP {step} OF {total}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: '#e2e8f0', marginTop: 2 }}>{title}</div>
    </div>
  );
}

// ── Read-only claim detail (reused by the After Market Warranty tab) ───────────
export function TireClaimDetail({ claim }) {
  const flagged = flaggedWheels(claim);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 20 }}>
        <DetailRow label="Customer" value={claim.customerName} />
        <DetailRow label="Repair Order" value={claim.repairOrder} mono />
        <DetailRow label="Created By" value={claim.createdBy} />
        <DetailRow label="Date" value={claim.updatedAt ? new Date(claim.updatedAt).toLocaleString() : ''} />
      </div>
      {claim.repairOrderPhoto && (
        <div style={{ marginBottom: 22 }}>
          <div style={labelSt}>Repair Order Photo</div>
          <PhotoThumb url={claim.repairOrderPhoto} />
        </div>
      )}
      {flagged.map(w => (
        <div key={w.key} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: accent, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${accent}33` }}>
            {w.label} — {damageLabel(claim.wheels[w.key])}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 14 }}>
            {wheelPhotoSlots(claim.wheels[w.key]).map(s => (
              <div key={s.key}>
                <div style={{ ...labelSt, marginBottom: 4 }}>{s.label}</div>
                <PhotoThumb url={claim.photos?.[w.key]?.[s.key]} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div>
      <div style={labelSt}>{label}</div>
      <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit' }}>{value || '—'}</div>
    </div>
  );
}

function PhotoThumb({ url }) {
  if (!url) return <div style={{ color: '#475569', fontSize: 12 }}>No photo</div>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="" style={{ width: '100%', maxWidth: 150, aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: `1px solid ${accent}55` }} />
    </a>
  );
}

// ── Claim list ────────────────────────────────────────────────────────────────
function ClaimList({ claims, loading, onNew, onView }) {
  return (
    <div style={{ padding: '16px 16px 40px' }}>
      {loading ? (
        <div style={{ textAlign: 'center', color: '#64748b', padding: 60 }}>Loading claims…</div>
      ) : claims.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 14 }}>🛞</div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>No tire claims yet</div>
          <div style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>Start a claim to document tire or rim damage.</div>
          <button onClick={onNew} style={{ ...primaryBtn(true), maxWidth: 240, margin: '0 auto' }}>+ Start a Claim</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640, margin: '0 auto' }}>
          {claims.map(c => {
            const wheels = flaggedWheels(c).map(w => w.key).join(', ');
            return (
              <button key={c.id} onClick={() => onView(c)}
                style={{ textAlign: 'left', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 15 }}>{c.customerName || '—'}</span>
                  <span style={{ color: '#64748b', fontSize: 12 }}>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 12, color: '#94a3b8' }}>
                  <span>RO <span style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{c.repairOrder || '—'}</span></span>
                  <span>Wheels: <span style={{ color: accent, fontWeight: 700 }}>{wheels || '—'}</span></span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TireWarranty({ currentUser, currentRole, onBack, backLabel }) {
  const [view, setView] = useState('list');    // 'list' | 'form' | 'detail'
  const [step, setStep] = useState(1);          // 1 | 2 | 3 (within 'form')
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedOk, setSavedOk] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [activeClaim, setActiveClaim] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    try {
      const index = await loadTireWarrantyIndex();
      setClaims(Array.isArray(index) ? index.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) : []);
    } catch {
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadClaims(); }, [loadClaims]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setWheel = (wheelKey, val) =>
    setForm(f => ({ ...f, wheels: { ...f.wheels, [wheelKey]: { ...f.wheels[wheelKey], ...val } } }));
  const setPhoto = (wheelKey, slotKey, url) =>
    setForm(f => ({ ...f, photos: { ...f.photos, [wheelKey]: { ...f.photos[wheelKey], [slotKey]: url } } }));

  function startNew() {
    setForm({ ...emptyForm(), createdBy: currentUser || '' });
    setStep(1);
    setSaveError('');
    setSavedOk(false);
    setView('form');
  }

  async function handleSave() {
    setSaving(true); setSaveError('');
    try {
      const finalForm = { ...form, updatedAt: new Date().toISOString() };
      const exists = claims.findIndex(c => c.id === finalForm.id);
      let next = exists >= 0 ? claims.map(c => c.id === finalForm.id ? finalForm : c) : [finalForm, ...claims];
      next.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      await saveTireWarrantyClaim(finalForm, next);
      setClaims(next);
      setSavedOk(true);
      setView('list');
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(claim) {
    const who = claim.customerName || claim.repairOrder || 'this claim';
    if (!window.confirm(`Delete the tire warranty claim for ${who}? This cannot be undone.`)) return;
    setDeleting(true); setSaveError('');
    try {
      await removeTireWarrantyClaim(claim);
      setClaims(prev => prev.filter(c => c.id !== claim.id));
      setActiveClaim(null);
      setView('list');
    } catch (err) {
      setSaveError(err.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  function topBack() {
    if (view === 'form') { setView('list'); return; }
    if (view === 'detail') { setView('list'); return; }
    onBack();
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#0d1627' }}>
      <div className="adv-topbar no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, position: 'sticky', top: 0, zIndex: 20 }}>
        <button className="secondary" onClick={topBack} disabled={saving}>
          {view === 'list' ? (backLabel || '← Back') : '← Claims'}
        </button>
        <span style={{ fontWeight: 800, fontSize: 17, color: accent, flex: 1 }}>🛞 Tire Warranty</span>
        {view === 'list' && (
          <button onClick={startNew}
            style={{ background: 'linear-gradient(135deg,rgba(251,191,36,0.35),rgba(245,158,11,0.25))', border: `1px solid ${accent}66`, color: accent, borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 700 }}>
            + New
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', maxWidth: 720, width: '100%', margin: '0 auto' }}>
        {savedOk && view === 'list' && (
          <div style={{ margin: '14px 16px 0', padding: '12px 16px', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.4)', borderRadius: 12, color: '#4ade80', fontWeight: 700, textAlign: 'center' }}>
            ✓ Claim saved
          </div>
        )}

        {view === 'list' && (
          <ClaimList claims={claims} loading={loading} onNew={startNew}
            onView={c => { setActiveClaim(c); setView('detail'); }} />
        )}

        {view === 'form' && step === 1 && (
          <StepStart form={form} set={set} onNext={() => setStep(2)} />
        )}
        {view === 'form' && step === 2 && (
          <StepMap form={form} setWheel={setWheel} onNext={() => setStep(3)} onBack={() => setStep(1)} />
        )}
        {view === 'form' && step === 3 && (
          <StepPhotos form={form} setPhoto={setPhoto} onSave={handleSave} onBack={() => setStep(2)}
            saving={saving} saveError={saveError} />
        )}

        {view === 'detail' && activeClaim && (
          <div style={{ padding: '18px 16px 40px' }}>
            <TireClaimDetail claim={activeClaim} />
            {saveError && <div style={{ color: '#f87171', fontSize: 13, textAlign: 'center', marginTop: 12 }}>{saveError}</div>}
            <button onClick={() => handleDelete(activeClaim)} disabled={deleting}
              style={{ width: '100%', marginTop: 20, background: 'rgba(248,113,133,0.12)', border: '1px solid rgba(248,113,133,0.5)', color: '#fb7185', borderRadius: 12, padding: '14px', cursor: deleting ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 15 }}>
              {deleting ? 'Deleting…' : '🗑 Delete Claim'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
