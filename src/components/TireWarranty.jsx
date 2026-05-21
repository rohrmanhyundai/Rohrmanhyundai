import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { loadTireWarrantyIndex, saveTireWarrantyClaim } from '../utils/github';
import { uploadTirePhotoToS3, ensureAwsCreds } from '../utils/s3';

const NHTSA = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';

// Common tire brands — used for the brand auto-complete.
const TIRE_BRANDS = [
  'Achilles', 'Atturo', 'BFGoodrich', 'Bridgestone', 'Continental', 'Cooper',
  'Crosswind', 'Dunlop', 'Falken', 'Firestone', 'Fuzion', 'General', 'Goodyear',
  'Hankook', 'Hercules', 'Ironman', 'Kelly', 'Kumho', 'Laufenn', 'Lexani',
  'Mastercraft', 'Maxxis', 'Michelin', 'Milestar', 'Nexen', 'Nitto', 'Nokian',
  'Pirelli', 'Sailun', 'Sentury', 'Sumitomo', 'Toyo', 'Uniroyal', 'Vercelli',
  'Vredestein', 'Westlake', 'Yokohama',
];

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const emptyForm = () => ({
  id: genId(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  firstName: '',
  lastName: '',
  customerPhone: '',
  vin: '',
  vehicleYear: '',
  vehicleMake: '',
  vehicleModel: '',
  tireWarrantyName: '',
  tireBrand: '',
  tireSize: '',
  tirePartNumber: '',
  treadDepth: '',
  dotNumber: '',
  partNumberPhoto: '',
  damagePhoto: '',
  treadDepthPhoto: '',
  dotNumberPhoto: '',
  sideViewPhoto: '',
  repairOrderPhoto: '',
  damageNotes: '',
});

// ── Shared styles ─────────────────────────────────────────────────────────────
const labelSt = {
  display: 'block', fontSize: 11, fontWeight: 700,
  color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
};
const inpSt = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8, color: '#e2e8f0', padding: '9px 12px', fontSize: 14, outline: 'none',
};
const roSt = {
  ...inpSt, background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)', color: '#64748b',
};
const accent = '#fbbf24'; // amber — tire theme

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 14, paddingBottom: 6, borderBottom: `1px solid ${accent}33` }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function F({ label, value, onChange, type = 'text', placeholder = '', readOnly = false, maxLength }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelSt}>{label}</label>
      <input type={type} value={value} onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder} readOnly={readOnly} maxLength={maxLength}
        style={readOnly ? roSt : inpSt} />
    </div>
  );
}

// ── Brand auto-complete ───────────────────────────────────────────────────────
function BrandField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const q = (value || '').trim().toLowerCase();
  const matches = q
    ? TIRE_BRANDS.filter(b => b.toLowerCase().startsWith(q) && b.toLowerCase() !== q)
    : [];
  return (
    <div style={{ marginBottom: 12, position: 'relative' }}>
      <label style={labelSt}>Tire Brand</label>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Start typing… e.g. Ku → Kumho"
        style={inpSt}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4, background: '#0f172a', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, maxHeight: 200, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {matches.map(b => (
            <div key={b}
              onMouseDown={() => { onChange(b); setOpen(false); }}
              style={{ padding: '8px 12px', fontSize: 14, color: '#e2e8f0', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {b}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Photo upload box ──────────────────────────────────────────────────────────
function PhotoBox({ label, value, onChange, claimId, field, allowPdf = false }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = file.type.startsWith('image/') || (allowPdf && file.type === 'application/pdf');
    if (!ok) { setError(allowPdf ? 'Please choose an image or PDF file.' : 'Please choose an image file.'); return; }
    setError('');
    setUploading(true);
    try {
      if (!(await ensureAwsCreds())) { setError('AWS credentials required.'); return; }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const filename = `${claimId}-${field}-${Date.now()}.${ext}`;
      const url = await uploadTirePhotoToS3(filename, file);
      onChange(url);
    } catch (err) {
      setError('Upload failed: ' + (err.message || err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelSt}>{label}</label>
      <input ref={inputRef} type="file" accept={allowPdf ? 'image/*,application/pdf' : 'image/*'}
        onChange={handleFile} style={{ display: 'none' }} />
      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a href={value} target="_blank" rel="noopener noreferrer">
            {value.toLowerCase().endsWith('.pdf') ? (
              <div style={{ width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: `1px solid ${accent}55`, background: 'rgba(255,255,255,0.05)', fontSize: 32 }}>📄</div>
            ) : (
              <img src={value} alt={label}
                style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8, border: `1px solid ${accent}55` }} />
            )}
          </a>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>✓ Photo uploaded</span>
            <button type="button" onClick={() => inputRef.current?.click()}
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Replace
            </button>
            <button type="button" onClick={() => onChange('')}
              style={{ background: 'transparent', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          style={{ width: '100%', background: 'rgba(251,191,36,0.08)', border: `1px dashed ${accent}66`, color: accent, borderRadius: 8, padding: '18px 12px', cursor: uploading ? 'wait' : 'pointer', fontSize: 13, fontWeight: 700 }}>
          {uploading ? 'Uploading…' : (allowPdf ? '📎 Add Photo or PDF' : '📷 Add Photo')}
        </button>
      )}
      {error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// ── Claim Form ────────────────────────────────────────────────────────────────
const ClaimForm = forwardRef(function ClaimForm({ initial, onSave, saving }, ref) {
  const [form, setForm] = useState(() => initial ? { ...initial } : emptyForm());
  const [vinLoading, setVinLoading] = useState(false);
  const [vinError, setVinError] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  useImperativeHandle(ref, () => ({
    getForm: () => ({ ...form, updatedAt: new Date().toISOString() }),
  }));

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const decodeVin = useCallback(async (vin) => {
    const v = vin.trim().toUpperCase();
    if (v.length < 17) { setVinError(''); return; }
    setVinLoading(true); setVinError('');
    try {
      const res = await fetch(`${NHTSA}/${v}?format=json`);
      const json = await res.json();
      const r = json.Results?.[0];
      const year = r?.ModelYear || '';
      const make = r?.Make || '';
      const model = r?.Model || '';
      if (!year && !make && !model) { setVinError('VIN not recognized'); return; }
      setForm(f => ({ ...f, vehicleYear: year, vehicleMake: make, vehicleModel: model }));
    } catch {
      setVinError('Could not decode VIN — check connection');
    } finally {
      setVinLoading(false);
    }
  }, []);

  // Every field below must be filled before a claim can be started.
  const required = {
    firstName: 'First name',
    lastName: 'Last name',
    vin: 'VIN',
    tireWarrantyName: 'Tire warranty name',
    tireBrand: 'Tire brand',
    tireSize: 'Tire size',
    tirePartNumber: 'Tire part number',
    treadDepth: 'Tire tread depth',
    dotNumber: 'DOT number',
    damageNotes: 'Explanation of why the tire is not repairable',
    damagePhoto: 'Unrepairable damage photo',
    sideViewPhoto: 'Complete side view photo of the tire',
    treadDepthPhoto: 'Tire tread depth photo',
    dotNumberPhoto: 'DOT number photo',
    repairOrderPhoto: 'Original repair order / proof of purchase',
  };
  const missing = Object.keys(required).filter(k => !String(form[k] || '').trim());

  function handleStartClaim() {
    if (missing.length > 0) { setShowErrors(true); return; }
    onSave({ ...form, updatedAt: new Date().toISOString() });
  }

  const errStyle = (key) => showErrors && !String(form[key] || '').trim()
    ? { boxShadow: '0 0 0 2px rgba(248,113,113,0.6)' } : {};

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Customer & Vehicle */}
        <Section title="Customer & Vehicle Information">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>First Name</label>
              <input value={form.firstName} onChange={e => set('firstName', e.target.value)}
                style={{ ...inpSt, ...errStyle('firstName') }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Last Name</label>
              <input value={form.lastName} onChange={e => set('lastName', e.target.value)}
                style={{ ...inpSt, ...errStyle('lastName') }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>VIN Number</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={form.vin}
                  onChange={e => { const v = e.target.value.toUpperCase(); set('vin', v); decodeVin(v); }}
                  placeholder="Enter 17-digit VIN"
                  maxLength={17}
                  style={{ ...inpSt, ...errStyle('vin'), fontFamily: 'monospace', letterSpacing: 1.5, flex: 1 }}
                />
                {vinLoading && <span style={{ color: '#64748b', fontSize: 12, flexShrink: 0 }}>Decoding…</span>}
              </div>
              {vinError && <div style={{ color: '#f87171', fontSize: 12, marginTop: 4 }}>{vinError}</div>}
              {form.vehicleYear && !vinLoading && (
                <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(251,191,36,0.1)', borderRadius: 6, fontSize: 13, color: accent, fontWeight: 600 }}>
                  ✓ {form.vehicleYear} {form.vehicleMake} {form.vehicleModel}
                </div>
              )}
            </div>
            <F label="Vehicle Year" value={form.vehicleYear} readOnly />
            <F label="Vehicle Make" value={form.vehicleMake} readOnly />
            <F label="Vehicle Model" value={form.vehicleModel} readOnly />
          </div>
        </Section>

        {/* Tire Information */}
        <Section title="Tire Information">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Tire Warranty Name</label>
              <input value={form.tireWarrantyName} onChange={e => set('tireWarrantyName', e.target.value)}
                placeholder="Name of the tire warranty"
                style={{ ...inpSt, ...errStyle('tireWarrantyName') }} />
            </div>
            <BrandField value={form.tireBrand} onChange={v => set('tireBrand', v)} />
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Tire Size</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={form.tireSize} onChange={e => set('tireSize', e.target.value)}
                  placeholder="e.g. 235/65R17"
                  style={{ ...inpSt, ...errStyle('tireSize'), flex: 1 }} />
                <a href="https://hyundaitirecenter.com/tires/tirebrand.jsp" target="_blank" rel="noopener noreferrer"
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', background: 'rgba(251,191,36,0.12)', border: `1px solid ${accent}66`, color: accent, borderRadius: 8, padding: '0 14px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                  🔎 Look Up Tires
                </a>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Tire Part Number</label>
              <input value={form.tirePartNumber} onChange={e => set('tirePartNumber', e.target.value)}
                style={{ ...inpSt, ...errStyle('tirePartNumber') }} />
            </div>
          </div>
        </Section>

        {/* Unrepairable Damage */}
        <Section title="Unrepairable Damage to Tire">
          <div style={{ marginBottom: 12 }}>
            <label style={labelSt}>Explain why the tire is not repairable</label>
            <textarea value={form.damageNotes} onChange={e => set('damageNotes', e.target.value)}
              rows={3} placeholder="Describe the damage and why the tire cannot be repaired"
              style={{ ...inpSt, resize: 'vertical', ...errStyle('damageNotes') }} />
          </div>
          <PhotoBox label="Unrepairable Damage Photo" value={form.damagePhoto}
            onChange={v => set('damagePhoto', v)} claimId={form.id} field="damage" />
          <PhotoBox label="Complete Side View Photo of the Tire" value={form.sideViewPhoto}
            onChange={v => set('sideViewPhoto', v)} claimId={form.id} field="sideview" />
        </Section>

        {/* Tread Depth */}
        <Section title="Tire Tread Depth">
          <div style={{ marginBottom: 12 }}>
            <label style={labelSt}>Tread Depth</label>
            <input value={form.treadDepth} onChange={e => set('treadDepth', e.target.value)}
              placeholder="e.g. 4/32"
              style={{ ...inpSt, ...errStyle('treadDepth') }} />
          </div>
          <PhotoBox label="Tire Tread Depth Photo" value={form.treadDepthPhoto}
            onChange={v => set('treadDepthPhoto', v)} claimId={form.id} field="tread" />
        </Section>

        {/* DOT Number */}
        <Section title="DOT Number">
          <div style={{ marginBottom: 12 }}>
            <label style={labelSt}>DOT Number</label>
            <input value={form.dotNumber} onChange={e => set('dotNumber', e.target.value)}
              style={{ ...inpSt, ...errStyle('dotNumber') }} />
          </div>
          <PhotoBox label="DOT Number Photo" value={form.dotNumberPhoto}
            onChange={v => set('dotNumberPhoto', v)} claimId={form.id} field="dot" />
        </Section>

        {/* Proof of Purchase */}
        <Section title="Original Repair Order / Proof of Purchase">
          <PhotoBox label="Upload Original Repair Order of Tire Purchase" value={form.repairOrderPhoto}
            onChange={v => set('repairOrderPhoto', v)} claimId={form.id} field="repairorder" allowPdf />
        </Section>

        {/* Validation summary + Start Claim */}
        {showErrors && missing.length > 0 && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 10 }}>
            <div style={{ color: '#f87171', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
              All fields and photos are required before starting the claim. Still needed:
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#fca5a5', fontSize: 13 }}>
              {missing.map(k => <li key={k}>{required[k]}</li>)}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleStartClaim} disabled={saving}
            style={{ background: missing.length === 0 ? 'linear-gradient(135deg,rgba(251,191,36,0.35),rgba(245,158,11,0.25))' : 'rgba(255,255,255,0.05)', border: `1px solid ${accent}66`, color: accent, borderRadius: 10, padding: '12px 32px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 15, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Starting…' : '🛞 Start Tire Claim'}
          </button>
        </div>
      </div>
    </div>
  );
});

// ── Claim Detail ──────────────────────────────────────────────────────────────
function DetailRow({ label, value, mono }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={labelSt}>{label}</div>
      <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit' }}>
        {value || '—'}
      </div>
    </div>
  );
}

function PhotoView({ label, url }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={labelSt}>{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url.toLowerCase().endsWith('.pdf') ? (
            <div style={{ width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: `1px solid ${accent}55`, background: 'rgba(255,255,255,0.05)', fontSize: 44 }}>📄</div>
          ) : (
            <img src={url} alt={label}
              style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 8, border: `1px solid ${accent}55` }} />
          )}
        </a>
      ) : <div style={{ color: '#64748b', fontSize: 13 }}>No file</div>}
    </div>
  );
}

function ClaimDetail({ claim, onEdit, onBack }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <Section title="Customer & Vehicle">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
            <DetailRow label="First Name" value={claim.firstName} />
            <DetailRow label="Last Name" value={claim.lastName} />
            <DetailRow label="VIN" value={claim.vin} mono />
            <DetailRow label="Vehicle" value={`${claim.vehicleYear} ${claim.vehicleMake} ${claim.vehicleModel}`.trim()} />
          </div>
        </Section>
        <Section title="Tire Information">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
            <DetailRow label="Tire Warranty Name" value={claim.tireWarrantyName} />
            <DetailRow label="Tire Brand" value={claim.tireBrand} />
            <DetailRow label="Tire Size" value={claim.tireSize} />
            <DetailRow label="Tire Part Number" value={claim.tirePartNumber} mono />
            <DetailRow label="Tread Depth" value={claim.treadDepth} />
            <DetailRow label="DOT Number" value={claim.dotNumber} mono />
          </div>
          {claim.damageNotes && <DetailRow label="Why Not Repairable" value={claim.damageNotes} />}
        </Section>
        <Section title="Photos & Documents">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 16 }}>
            <PhotoView label="Unrepairable Damage" url={claim.damagePhoto} />
            <PhotoView label="Complete Side View" url={claim.sideViewPhoto} />
            <PhotoView label="Tire Tread Depth" url={claim.treadDepthPhoto} />
            <PhotoView label="DOT Number" url={claim.dotNumberPhoto} />
            <PhotoView label="Original Repair Order" url={claim.repairOrderPhoto} />
          </div>
        </Section>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onBack} className="secondary">← Claims</button>
          <button onClick={onEdit}
            style={{ background: 'linear-gradient(135deg,rgba(251,191,36,0.35),rgba(245,158,11,0.25))', border: `1px solid ${accent}66`, color: accent, borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800 }}>
            ✏️ Edit Claim
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Claim List ────────────────────────────────────────────────────────────────
function ClaimList({ claims, loading, onNew, onView }) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const filtered = q
    ? claims.filter(c =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        String(c.vin || '').toLowerCase().includes(q) ||
        String(c.tirePartNumber || '').toLowerCase().includes(q))
    : claims;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 32px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {!loading && claims.length > 0 && (
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, VIN, or part number…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#e2e8f0', fontSize: 14, outline: 'none', marginBottom: 16 }} />
        )}
        {loading ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 60 }}>Loading claims…</div>
        ) : claims.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🛞</div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>No tire claims yet</div>
            <div style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>Click "New Claim" to start a tire warranty claim.</div>
            <button onClick={onNew}
              style={{ background: 'linear-gradient(135deg,rgba(251,191,36,0.35),rgba(245,158,11,0.25))', border: `1px solid ${accent}66`, color: accent, borderRadius: 10, padding: '12px 28px', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
              + New Claim
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date', 'Customer', 'Vehicle', 'Tire Brand', 'Part Number', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#64748b', padding: 40, fontSize: 13 }}>No claims match "{search}"</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id} onClick={() => onView(c)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b' }}>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{`${c.firstName || ''} ${c.lastName || ''}`.trim() || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: '#94a3b8' }}>{`${c.vehicleYear || ''} ${c.vehicleMake || ''} ${c.vehicleModel || ''}`.trim() || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: '#e2e8f0' }}>{c.tireBrand || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: 'monospace', color: accent }}>{c.tirePartNumber || '—'}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                    <span style={{ fontSize: 12, color: accent, fontWeight: 600 }}>View →</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TireWarranty({ currentUser, currentRole, onBack, backLabel }) {
  const [view, setView] = useState('list');       // 'list' | 'form' | 'detail'
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeClaim, setActiveClaim] = useState(null);
  const [editingClaim, setEditingClaim] = useState(null);
  const [saveError, setSaveError] = useState('');
  const formRef = useRef(null);

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

  async function handleSave(form) {
    setSaving(true); setSaveError('');
    try {
      const exists = claims.findIndex(c => c.id === form.id);
      let next;
      if (exists >= 0) next = claims.map(c => c.id === form.id ? form : c);
      else next = [form, ...claims];
      next.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      await saveTireWarrantyClaim(form, next);
      setClaims(next);
      setActiveClaim(form);
      setView('detail');
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button className="secondary" onClick={() => {
          if (view === 'list') { onBack(); return; }
          setView('list');
        }}>
          {view === 'list' ? (backLabel || '← Back') : '← Claims'}
        </button>
        <span style={{ fontWeight: 800, fontSize: 18, color: accent, flex: 1 }}>🛞 Tire Warranty</span>
        {view === 'list' && (
          <button onClick={() => { setEditingClaim(null); setView('form'); }}
            style={{ background: 'linear-gradient(135deg,rgba(251,191,36,0.35),rgba(245,158,11,0.25))', border: `1px solid ${accent}66`, color: accent, borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 700 }}>
            + New Claim
          </button>
        )}
        {saveError && <span style={{ color: '#f87171', fontSize: 13 }}>{saveError}</span>}
      </div>

      {view === 'list' && (
        <ClaimList claims={claims} loading={loading}
          onNew={() => { setEditingClaim(null); setView('form'); }}
          onView={c => { setActiveClaim(c); setView('detail'); }} />
      )}
      {view === 'form' && (
        <ClaimForm ref={formRef} initial={editingClaim} onSave={handleSave} saving={saving} />
      )}
      {view === 'detail' && activeClaim && (
        <ClaimDetail claim={activeClaim}
          onEdit={() => { setEditingClaim(activeClaim); setView('form'); }}
          onBack={() => setView('list')} />
      )}
    </div>
  );
}
