import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { loadWarrantyIndex, loadWarrantyContract, saveWarrantyContract } from '../utils/github';

const NHTSA = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const emptyPart = () => ({ id: genId(), partNumber: '', description: '', qty: '1', price: '' });

const emptyForm = () => ({
  id: genId(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dealershipName: 'Bob Rohrman Hyundai',
  customerName: '',
  customerPhone: '',
  repairOrder: '',
  vin: '',
  vehicleYear: '',
  vehicleMake: '',
  vehicleModel: '',
  mileage: '',
  warrantyCompany: '',
  warrantyPhone: '',
  claimNumber: '',
  laborRate: '',
  laborTime: '',
  diagnosisTime: '',
  parts: [emptyPart()],
  taxPct: '',
  deductible: '',
  rental: '',
  towing: '',
  sublet: '',
  notes: '',
  approved: false,
  approvedDate: '',
  waiting: false,
  waitingDate: '',
  paid: false,
  paymentDate: '',
  repairsFinished: false,
  repairsFinishedDate: '',
  readySubmission: false,
  readySubmissionDate: '',
});

function num(v) { return parseFloat(v) || 0; }
function fmtDol(v) { return '$' + num(v).toFixed(2); }

function calcTotals(form) {
  const laborTotal = num(form.laborRate) * (num(form.laborTime) + num(form.diagnosisTime));
  const partsTotal = (form.parts || []).reduce((s, p) => s + num(p.qty || 1) * num(p.price), 0);
  const taxAmt = partsTotal * (num(form.taxPct) / 100);
  const deductible = num(form.deductible);
  const rental = num(form.rental);
  const towing = num(form.towing);
  const sublet = num(form.sublet);
  const totalClaim = laborTotal + partsTotal + taxAmt + rental + towing + sublet - deductible;
  const totalDue = deductible;
  return { laborTotal, partsTotal, taxAmt, rental, towing, sublet, totalClaim, totalDue };
}

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

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 14, paddingBottom: 6, borderBottom: '1px solid rgba(61,214,195,0.2)' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function F({ label, value, onChange, type = 'text', placeholder = '', readOnly = false }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelSt}>{label}</label>
      <input type={type} value={value} onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder} readOnly={readOnly}
        style={readOnly ? roSt : inpSt} />
    </div>
  );
}

function TotalBox({ label, value, color = '#3dd6c3', big = false }) {
  return (
    <div style={{ padding: big ? '14px 16px' : '10px 14px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${color}30`, borderRadius: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: big ? 22 : 16, fontWeight: 900, color }}>{value}</div>
    </div>
  );
}

// ── Status Buttons with Date Popup ───────────────────────────────────────────
// exclusive: true means only one of these can be active at a time
const STATUS_BTNS = [
  { key: 'readySubmission', dateKey: 'readySubmissionDate', label: '📋 Ready for Submission', exclusive: true, group: 'status', on: { bg: 'rgba(56,189,248,0.28)',  border: 'rgba(56,189,248,0.65)',  text: '#7dd3fc' }, off: { bg: 'rgba(56,189,248,0.07)',  border: 'rgba(56,189,248,0.28)',  text: '#38bdf8' } },
  { key: 'approved',        dateKey: 'approvedDate',        label: '✅ Approved Claim',        exclusive: true, group: 'status', on: { bg: 'rgba(74,222,128,0.25)',  border: 'rgba(74,222,128,0.6)',   text: '#4ade80' }, off: { bg: 'rgba(74,222,128,0.07)',  border: 'rgba(74,222,128,0.22)',  text: '#4ade80' } },
  { key: 'repairsFinished', dateKey: 'repairsFinishedDate', label: '🔧 Repairs Finished',      exclusive: true, group: 'status', on: { bg: 'rgba(239,68,68,0.28)',   border: 'rgba(239,68,68,0.65)',   text: '#fca5a5' }, off: { bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.28)',   text: '#f87171' } },
  { key: 'waiting',         dateKey: 'waitingDate',         label: '⏳ Waiting for Payment',   exclusive: true, group: 'payment', on: { bg: 'rgba(251,191,36,0.25)',  border: 'rgba(251,191,36,0.6)',   text: '#fbbf24' }, off: { bg: 'rgba(251,191,36,0.07)',  border: 'rgba(251,191,36,0.22)',  text: '#fbbf24' } },
  { key: 'paid',            dateKey: 'paymentDate',         label: '💳 Claim Paid',            exclusive: true, group: 'payment', on: { bg: 'rgba(110,231,249,0.25)', border: 'rgba(110,231,249,0.6)',  text: '#6ee7f9' }, off: { bg: 'rgba(110,231,249,0.07)', border: 'rgba(110,231,249,0.22)', text: '#6ee7f9' } },
];

function StatusButtons({ form, setForm }) {
  const [openKey, setOpenKey] = useState(null);
  const [popupDate, setPopupDate] = useState('');
  const [popupPos, setPopupPos]   = useState({ top: 0, left: 0 });
  const popupRef = useRef(null);

  // Close popup on outside click
  React.useEffect(() => {
    if (!openKey) return;
    function handler(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) setOpenKey(null);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openKey]);

  function handleBtnClick(btn, e) {
    if (openKey === btn.key) { setOpenKey(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setPopupPos({ top: rect.bottom + 8, left: rect.left });
    setPopupDate(form[btn.dateKey] || new Date().toISOString().slice(0, 10));
    setOpenKey(btn.key);
  }

  function handleSave(btn) {
    setForm(f => {
      const update = { ...f, [btn.key]: true, [btn.dateKey]: popupDate };
      // Clear others in the same exclusive group
      if (btn.exclusive) {
        STATUS_BTNS.filter(b => b.exclusive && b.group === btn.group && b.key !== btn.key).forEach(other => {
          update[other.key] = false;
          update[other.dateKey] = '';
        });
      }
      return update;
    });
    setOpenKey(null);
  }

  function handleRemove(btn) {
    setForm(f => ({ ...f, [btn.key]: false, [btn.dateKey]: '' }));
    setOpenKey(null);
  }

  const activeBtn = STATUS_BTNS.find(b => b.key === openKey);

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20, marginTop: 8, marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {STATUS_BTNS.map(btn => {
          const active = !!form[btn.key];
          const st = active ? btn.on : btn.off;
          return (
            <button key={btn.key} onClick={e => handleBtnClick(btn, e)}
              style={{ background: st.bg, border: `1px solid ${st.border}`, color: st.text, borderRadius: 10, padding: '10px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13, outline: openKey === btn.key ? `2px solid ${st.border}` : 'none', outlineOffset: 2 }}>
              {btn.label}
            </button>
          );
        })}
      </div>

      {/* Date popup — fixed so it's never clipped by scroll containers */}
      {openKey && activeBtn && (
        <div ref={popupRef} style={{ position: 'fixed', top: popupPos.top, left: popupPos.left, zIndex: 9999, background: '#0f172a', border: `1px solid ${activeBtn.on.border}`, borderRadius: 12, padding: '14px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', minWidth: 260 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: activeBtn.on.text, marginBottom: 10 }}>{activeBtn.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>Date:</label>
            <input type="date" value={popupDate} onChange={e => setPopupDate(e.target.value)}
              style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: `1px solid ${activeBtn.on.border}`, borderRadius: 7, color: activeBtn.on.text, padding: '6px 10px', fontSize: 13, fontWeight: 700, outline: 'none', colorScheme: 'dark' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleSave(activeBtn)}
              style={{ flex: 1, background: activeBtn.on.bg, border: `1px solid ${activeBtn.on.border}`, color: activeBtn.on.text, borderRadius: 8, padding: '8px 0', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
              Save
            </button>
            <button onClick={() => handleRemove(activeBtn)}
              style={{ flex: 1, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', borderRadius: 8, padding: '8px 0', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Contract Form ─────────────────────────────────────────────────────────────
const ContractForm = forwardRef(function ContractForm({ initial, onSave, onCancel, onDelete, saving, currentRole }, ref) {
  const [form, setForm] = useState(() => initial ? { ...initial } : emptyForm());

  useImperativeHandle(ref, () => ({
    getForm: () => ({ ...form, updatedAt: new Date().toISOString() }),
  }));
  const [vinLoading, setVinLoading] = useState(false);
  const [vinError, setVinError] = useState('');

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

  function addPart() { setForm(f => ({ ...f, parts: [...f.parts, emptyPart()] })); }
  function removePart(id) { setForm(f => ({ ...f, parts: f.parts.filter(p => p.id !== id) })); }
  function setPart(id, key, val) {
    setForm(f => ({ ...f, parts: f.parts.map(p => p.id === id ? { ...p, [key]: val } : p) }));
  }

  const { laborTotal, partsTotal, taxAmt, totalClaim, totalDue } = calcTotals(form);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Customer & Vehicle */}
        <Section title="Customer & Vehicle Information">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            <F label="Dealership Name" value={form.dealershipName} onChange={v => set('dealershipName', v)} />
            <F label="Customer Name" value={form.customerName} onChange={v => set('customerName', v)} />
            <F label="Customer Phone" value={form.customerPhone} onChange={v => set('customerPhone', v)} type="tel" />
            <F label="Repair Order #" value={form.repairOrder} onChange={v => set('repairOrder', v)} placeholder="RO-XXXXXXXX" />
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>VIN Number</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={form.vin}
                  onChange={e => { const v = e.target.value.toUpperCase(); set('vin', v); decodeVin(v); }}
                  placeholder="Enter 17-digit VIN"
                  maxLength={17}
                  style={{ ...inpSt, fontFamily: 'monospace', letterSpacing: 1.5, flex: 1 }}
                />
                {vinLoading && <span style={{ color: '#64748b', fontSize: 12, flexShrink: 0 }}>Decoding…</span>}
              </div>
              {vinError && <div style={{ color: '#f87171', fontSize: 12, marginTop: 4 }}>{vinError}</div>}
              {form.vehicleYear && !vinLoading && (
                <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(61,214,195,0.08)', borderRadius: 6, fontSize: 13, color: '#3dd6c3', fontWeight: 600 }}>
                  ✓ {form.vehicleYear} {form.vehicleMake} {form.vehicleModel}
                </div>
              )}
            </div>
            <F label="Vehicle Year" value={form.vehicleYear} onChange={v => set('vehicleYear', v)} readOnly />
            <F label="Vehicle Make" value={form.vehicleMake} onChange={v => set('vehicleMake', v)} readOnly />
            <F label="Vehicle Model" value={form.vehicleModel} onChange={v => set('vehicleModel', v)} readOnly />
            <F label="Mileage" value={form.mileage} onChange={v => set('mileage', v)} type="number" placeholder="0" />
          </div>
        </Section>

        {/* Warranty Company */}
        <Section title="Warranty Company">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            <F label="Warranty Company Name" value={form.warrantyCompany} onChange={v => set('warrantyCompany', v)} />
            <F label="Warranty Company Phone" value={form.warrantyPhone} onChange={v => set('warrantyPhone', v)} type="tel" />
            <F label="Claim Number" value={form.claimNumber} onChange={v => set('claimNumber', v)} placeholder="WC-XXXXXXXX" />
          </div>
        </Section>

        {/* Labor */}
        <Section title="Labor">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0 16px' }}>
            <F label="Labor Rate ($/hr)" value={form.laborRate} onChange={v => set('laborRate', v)} type="number" placeholder="0.00" />
            <F label="Labor Time (hrs)" value={form.laborTime} onChange={v => set('laborTime', v)} type="number" placeholder="0.0" />
            <F label="Diagnosis Time (hrs)" value={form.diagnosisTime} onChange={v => set('diagnosisTime', v)} type="number" placeholder="0.0" />
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', padding: '10px 14px', background: 'rgba(61,214,195,0.08)', border: '1px solid rgba(61,214,195,0.2)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Labor Total</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#3dd6c3', marginTop: 2 }}>{fmtDol(laborTotal)}</div>
              </div>
            </div>
          </div>
        </Section>

        {/* Parts */}
        <Section title="Parts">
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 72px 110px 36px', gap: 8, marginBottom: 6 }}>
              <label style={labelSt}>Part Number</label>
              <label style={labelSt}>Description</label>
              <label style={labelSt}>Qty</label>
              <label style={labelSt}>Unit Price ($)</label>
              <div />
            </div>
            {form.parts.map(p => (
              <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 72px 110px 36px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input value={p.partNumber} onChange={e => setPart(p.id, 'partNumber', e.target.value)}
                  placeholder="Part #" style={{ ...inpSt, fontFamily: 'monospace', fontSize: 13 }} />
                <input value={p.description} onChange={e => setPart(p.id, 'description', e.target.value)}
                  placeholder="Part description" style={inpSt} />
                <input type="number" value={p.qty ?? '1'} min="1" step="1"
                  onChange={e => setPart(p.id, 'qty', e.target.value)}
                  style={{ ...inpSt, textAlign: 'center' }} />
                <input type="number" value={p.price} onChange={e => setPart(p.id, 'price', e.target.value)}
                  placeholder="0.00" style={inpSt} />
                <button onClick={() => removePart(p.id)} disabled={form.parts.length === 1}
                  style={{ width: 36, height: 36, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#f87171', cursor: form.parts.length === 1 ? 'not-allowed' : 'pointer', fontSize: 14, opacity: form.parts.length === 1 ? 0.4 : 1 }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <button onClick={addPart} style={{ background: 'rgba(61,214,195,0.1)', border: '1px solid rgba(61,214,195,0.3)', color: '#3dd6c3', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              + Add Part
            </button>
            <div style={{ fontSize: 14, color: '#64748b' }}>Parts Total: <span style={{ color: '#3dd6c3', fontWeight: 800, fontSize: 16 }}>{fmtDol(partsTotal)}</span></div>
          </div>
        </Section>

        {/* Totals */}
        <Section title="Financials">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px', marginBottom: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Tax Rate (%)</label>
              <input type="number" value={form.taxPct} onChange={e => set('taxPct', e.target.value)}
                placeholder="e.g. 7.5" min="0" max="100" step="0.01" style={inpSt} />
              <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                Tax on parts: <span style={{ color: '#3dd6c3', fontWeight: 700 }}>{fmtDol(taxAmt)}</span>
                {num(form.taxPct) > 0 && <span style={{ color: '#475569' }}> ({num(form.taxPct)}% of {fmtDol(partsTotal)})</span>}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Tax Amount ($)</label>
              <input value={taxAmt.toFixed(2)} readOnly style={roSt} />
            </div>
            <F label="Deductible ($)" value={form.deductible} onChange={v => set('deductible', v)} type="number" placeholder="0.00" />
          </div>

          {/* Additional charges — Rental / Towing / Sublet */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Additional Charges</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { key: 'rental', label: 'RENTAL', color: '#a78bfa', bg: 'rgba(167,139,250,', border: 'rgba(167,139,250,' },
                { key: 'towing', label: 'TOWING', color: '#fb923c', bg: 'rgba(251,146,60,', border: 'rgba(251,146,60,' },
                { key: 'sublet', label: 'SUBLET', color: '#6ee7f9', bg: 'rgba(110,231,249,', border: 'rgba(110,231,249,' },
              ].map(({ key, label, color, bg, border }) => {
                const active = form[key] !== '';
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: active ? `${bg}0.1)` : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? `${border}0.4)` : 'rgba(255,255,255,0.12)'}`, borderRadius: 10, padding: '8px 14px', transition: 'all .15s' }}>
                    <button
                      onClick={() => set(key, active ? '' : '0')}
                      style={{ background: active ? `${bg}0.25)` : 'rgba(255,255,255,0.06)', border: `1px solid ${active ? `${border}0.5)` : 'rgba(255,255,255,0.15)'}`, color: active ? color : '#64748b', borderRadius: 7, padding: '5px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12, letterSpacing: 0.5, transition: 'all .15s' }}
                    >{label}</button>
                    {active && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>$</span>
                        <input
                          type="number"
                          value={form[key]}
                          onChange={e => set(key, e.target.value)}
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          autoFocus
                          style={{ ...inpSt, width: 110, padding: '6px 10px', fontSize: 13, color, fontWeight: 700 }}
                        />
                        {num(form[key]) > 0 && <span style={{ fontSize: 12, color, fontWeight: 700 }}>{fmtDol(num(form[key]))}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {(num(form.rental) > 0 || num(form.towing) > 0 || num(form.sublet) > 0) && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                Additional total: <span style={{ color: '#a78bfa', fontWeight: 700 }}>{fmtDol(num(form.rental) + num(form.towing) + num(form.sublet))}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            <TotalBox label="Labor Total" value={fmtDol(laborTotal)} />
            <TotalBox label="Parts Total" value={fmtDol(partsTotal)} />
            <TotalBox label="Tax" value={fmtDol(taxAmt)} />
            {num(form.rental) > 0 && <TotalBox label="Rental" value={fmtDol(num(form.rental))} color="#a78bfa" />}
            {num(form.towing) > 0 && <TotalBox label="Towing" value={fmtDol(num(form.towing))} color="#fb923c" />}
            {num(form.sublet) > 0 && <TotalBox label="Sublet" value={fmtDol(num(form.sublet))} color="#6ee7f9" />}
            <TotalBox label="Total Warranty Claim" value={fmtDol(totalClaim)} color="#6ee7f9" big />
            <TotalBox label="Total Due by Customer" value={fmtDol(totalDue)} color="#fbbf24" big />
          </div>
        </Section>

        {/* Notes */}
        <Section title="Notes">
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Additional notes…" rows={3}
            style={{ ...inpSt, resize: 'vertical', fontFamily: 'inherit' }} />
        </Section>

        {/* ── Action bar ── */}
        <StatusButtons form={form} setForm={setForm} />

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20, marginTop: 8 }}>
          {/* Row 2 — form actions */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {(currentRole === 'admin' || (currentRole || '').includes('manager')) && onDelete && (
              <button onClick={onDelete}
                style={{ background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.28)', color: '#f87171', borderRadius: 10, padding: '10px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                🗑 Delete Claim
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={onCancel} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#94a3b8', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontSize: 14 }}>
              Cancel
            </button>
            <button onClick={() => onSave({ ...form, updatedAt: new Date().toISOString() })} disabled={saving}
              style={{ background: 'linear-gradient(135deg,rgba(61,214,195,0.3),rgba(110,231,249,0.2))', border: '1px solid rgba(61,214,195,0.4)', color: '#6ee7f9', borderRadius: 10, padding: '10px 28px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 15, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : '💾 Save Contract'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// ── Print / Detail View ───────────────────────────────────────────────────────
function PrintRow({ label, value, bold = false }) {
  return (
    <tr>
      <td style={{ padding: '5px 10px', fontWeight: 600, color: '#555', fontSize: 13, verticalAlign: 'top', width: '38%' }}>{label}</td>
      <td style={{ padding: '5px 10px', color: bold ? '#000' : '#222', fontWeight: bold ? 800 : 400, fontSize: 13, wordBreak: 'break-all' }}>{value}</td>
    </tr>
  );
}

function ContractDetail({ contract, onEdit, onBack }) {
  const { laborTotal, partsTotal, taxAmt, totalClaim, totalDue } = calcTotals(contract);
  const date = contract.updatedAt ? new Date(contract.updatedAt).toLocaleDateString() : '';
  const pdfRef = useRef(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  function handlePrint() {
    window.print();
  }

  async function handleSavePDF() {
    if (!pdfRef.current) return;
    setGeneratingPDF(true);
    let clone = null;
    try {
      // Clone the print element and attach directly to <body> so it renders
      // at a known position with no scroll offset or clipping from parent containers.
      clone = pdfRef.current.cloneNode(true);
      clone.style.cssText = [
        'display:block',
        'position:fixed',
        'left:-9999px',
        'top:0',
        'width:816px',
        'background:#ffffff',
        'padding:0',
        'margin:0',
        'box-sizing:border-box',
        'z-index:-1',
        'overflow:visible',
      ].join(';');
      document.body.appendChild(clone);

      await new Promise(r => setTimeout(r, 250)); // let browser fully render the clone

      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: 816,
        height: clone.scrollHeight,  // full content height, not clamped to viewport
        windowWidth: 816,
        scrollX: 0,
        scrollY: 0,
      });

      document.body.removeChild(clone);
      clone = null;

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const pageW = pdf.internal.pageSize.getWidth();   // 215.9 mm
      const pageH = pdf.internal.pageSize.getHeight();  // 279.4 mm
      const margin = 10;
      const contentW = pageW - 2 * margin;
      const contentH = pageH - 2 * margin;

      const pxPerMm    = canvas.width / contentW;
      const pageHtPx   = Math.round(contentH * pxPerMm);
      const totalPages = Math.ceil(canvas.height / pageHtPx);

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) pdf.addPage();

        const startY  = page * pageHtPx;
        const sliceH  = Math.min(pageHtPx, canvas.height - startY);
        const sliceMm = sliceH / pxPerMm; // exact mm for this slice (last page may be shorter)

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width  = canvas.width;
        pageCanvas.height = sliceH;
        const ctx = pageCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, startY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', margin, margin, contentW, sliceMm);
      }

      const filename = `Warranty_${(contract.customerName || 'Contract').replace(/\s+/g,'_')}_RO${contract.repairOrder || contract.claimNumber || ''}.pdf`;
      pdf.save(filename);
    } catch (err) {
      alert('PDF generation failed: ' + err.message);
    } finally {
      if (clone && clone.parentNode) clone.parentNode.removeChild(clone);
      setGeneratingPDF(false);
    }
  }

  return (
    <>
      {/* Print CSS */}
      <style>{`
        @media print {
          .amw-no-print { display: none !important; }
          .amw-print-doc { display: block !important; }
          .amw-screen-preview { display: none !important; }
          @page { size: letter portrait; margin: 8mm 10mm; }
        }
        .amw-print-doc { display: none; }
      `}</style>

      {/* Screen toolbar */}
      <div className="adv-topbar amw-no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button className="secondary" onClick={onBack}>← Back</button>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: '#6ee7f9' }}>
          {contract.customerName || 'Contract'} — {contract.vehicleYear} {contract.vehicleMake} {contract.vehicleModel}
        </span>
        <button onClick={onEdit}
          style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 600 }}>
          ✏️ Edit
        </button>
        <button onClick={handlePrint}
          style={{ background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.3)', color: '#94a3b8', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 600 }}>
          🖨 Print
        </button>
        <button onClick={handleSavePDF} disabled={generatingPDF}
          style={{ background: 'linear-gradient(135deg,rgba(61,214,195,0.2),rgba(110,231,249,0.15))', border: '1px solid rgba(61,214,195,0.35)', color: '#3dd6c3', borderRadius: 8, padding: '8px 18px', cursor: generatingPDF ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: generatingPDF ? 0.7 : 1 }}>
          {generatingPDF ? '⏳ Generating…' : '⬇ Save PDF'}
        </button>
      </div>

      {/* Print-only document (also used for PDF capture via ref) */}
      <div className="amw-print-doc" ref={pdfRef}>
        <PrintDocument contract={contract} laborTotal={laborTotal} partsTotal={partsTotal} taxAmt={taxAmt} rental={rental} towing={towing} sublet={sublet} totalClaim={totalClaim} totalDue={totalDue} date={date} />
      </div>

      {/* Screen preview (styled like the print doc but in dark theme) */}
      <div className="amw-screen-preview" style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 60px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '32px 36px' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingBottom: 16, borderBottom: '2px solid rgba(61,214,195,0.3)' }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 22, color: '#6ee7f9' }}>{contract.dealershipName}</div>
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>Aftermarket Warranty Claim</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0' }}>Claim # {contract.claimNumber || '—'}</div>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{date}</div>
            </div>
          </div>

          {/* Two-column info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
            <InfoBlock title="Customer">
              <InfoRow label="Name" value={contract.customerName} />
              <InfoRow label="Phone" value={contract.customerPhone} />
              <InfoRow label="Repair Order #" value={contract.repairOrder} />
            </InfoBlock>
            <InfoBlock title="Warranty Company">
              <InfoRow label="Company" value={contract.warrantyCompany} />
              <InfoRow label="Phone" value={contract.warrantyPhone} />
              <InfoRow label="Claim #" value={contract.claimNumber} />
            </InfoBlock>
            <InfoBlock title="Vehicle">
              <InfoRow label="VIN" value={contract.vin} mono />
              <InfoRow label="Year / Make / Model" value={`${contract.vehicleYear} ${contract.vehicleMake} ${contract.vehicleModel}`} />
              <InfoRow label="Mileage" value={contract.mileage ? Number(contract.mileage).toLocaleString() + ' mi' : '—'} />
            </InfoBlock>
            <InfoBlock title="Labor">
              <InfoRow label="Rate" value={`$${num(contract.laborRate).toFixed(2)}/hr`} />
              <InfoRow label="Labor Time" value={`${num(contract.laborTime).toFixed(1)} hrs`} />
              <InfoRow label="Diagnosis Time" value={`${num(contract.diagnosisTime).toFixed(1)} hrs`} />
              <InfoRow label="Labor Total" value={fmtDol(laborTotal)} highlight />
            </InfoBlock>
          </div>

          {/* Parts table */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid rgba(61,214,195,0.2)' }}>Parts</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {['Part Number', 'Description', 'Qty', 'Unit Price', 'Total'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: i >= 2 ? 'center' : 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(contract.parts || []).map((p, i) => {
                  const qty = num(p.qty || 1);
                  const lineTotal = qty * num(p.price);
                  return (
                    <tr key={p.id || i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: '#94a3b8', fontFamily: 'monospace' }}>{p.partNumber || '—'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: '#e2e8f0' }}>{p.description || '—'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: '#e2e8f0', textAlign: 'center' }}>{qty}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>{fmtDol(num(p.price))}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: '#e2e8f0', textAlign: 'right', fontWeight: 600 }}>{fmtDol(lineTotal)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={4} style={{ padding: '8px 12px', fontWeight: 700, color: '#64748b', fontSize: 13, textAlign: 'right' }}>Parts Total</td>
                  <td style={{ padding: '8px 12px', fontWeight: 800, color: '#3dd6c3', fontSize: 14, textAlign: 'right' }}>{fmtDol(partsTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
            <TotalBox label="Labor Total" value={fmtDol(laborTotal)} />
            <TotalBox label="Parts Total" value={fmtDol(partsTotal)} />
            <TotalBox label="Tax" value={fmtDol(taxAmt)} />
            {num(contract.rental) > 0 && <TotalBox label="Rental" value={fmtDol(rental)} color="#a78bfa" />}
            {num(contract.towing) > 0 && <TotalBox label="Towing" value={fmtDol(towing)} color="#fb923c" />}
            {num(contract.sublet) > 0 && <TotalBox label="Sublet" value={fmtDol(sublet)} color="#6ee7f9" />}
            <TotalBox label="Total Warranty Claim" value={fmtDol(totalClaim)} color="#6ee7f9" big />
            <TotalBox label="Total Due by Customer" value={fmtDol(totalDue)} color="#fbbf24" big />
          </div>

          {contract.notes && (
            <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Notes</div>
              <div style={{ fontSize: 13, color: '#94a3b8', whiteSpace: 'pre-wrap' }}>{contract.notes}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function InfoBlock({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid rgba(61,214,195,0.15)' }}>{title}</div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, highlight = false, mono = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', gap: 12 }}>
      <span style={{ color: '#64748b', fontSize: 12, flexShrink: 0 }}>{label}</span>
      <span style={{ color: highlight ? '#3dd6c3' : '#e2e8f0', fontWeight: highlight ? 800 : 400, fontSize: 12, fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right' }}>{value || '—'}</span>
    </div>
  );
}

// ── Print document (white/light, for actual printing & PDF export) ────────────
function PrintDocument({ contract, laborTotal, partsTotal, taxAmt, rental, towing, sublet, totalClaim, totalDue, date }) {
  const isApproved = !!(contract.approved ?? (contract.status === 'approved'));
  const isWaiting  = !!(contract.waiting  ?? (contract.status === 'waiting'));
  const isPaid     = !!(contract.paid     ?? (contract.status === 'paid'));
  const statusBadges = [
    isPaid     && { label: '💳 CLAIM PAID',          color: '#0369a1' },
    isWaiting  && { label: '⏳ WAITING FOR PAYMENT', color: '#b45309' },
    isApproved && { label: '✅ APPROVED',             color: '#16a34a' },
  ].filter(Boolean);

  const cell = (label, value, mono = false) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#0f172a', fontFamily: mono ? 'monospace' : 'inherit', fontWeight: mono ? 600 : 400, wordBreak: 'break-all', lineHeight: 1.4 }}>{value || '—'}</div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Segoe UI', Arial, sans-serif", color: '#0f172a', background: '#ffffff', width: '100%', boxSizing: 'border-box' }}>

      {/* ── Header Banner ── */}
      <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', padding: '22px 32px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 24, color: '#ffffff', letterSpacing: -0.5 }}>{contract.dealershipName || 'Bob Rohrman Hyundai'}</div>
            <div style={{ fontSize: 13, color: '#67e8f9', marginTop: 4, fontWeight: 500, letterSpacing: 0.5 }}>AFTERMARKET WARRANTY CLAIM</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {statusBadges.length > 0 && (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
                {statusBadges.map(b => (
                  <span key={b.label} style={{ display: 'inline-block', background: b.color, color: '#fff', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, letterSpacing: 0.5 }}>{b.label}</span>
                ))}
              </div>
            )}
            <div style={{ color: '#cbd5e1', fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: '#ffffff' }}>Claim #</span> {contract.claimNumber || '—'}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>
              <span style={{ fontWeight: 600, color: '#cbd5e1' }}>RO #</span> {contract.repairOrder || '—'}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>Date: {date}</div>
          </div>
        </div>
        {/* Teal accent bar */}
        <div style={{ height: 3, background: 'linear-gradient(90deg, #06b6d4, #3dd6c3, #06b6d4)', borderRadius: 2, marginTop: 16 }} />
      </div>

      {/* ── Body ── */}
      <div style={{ padding: '24px 32px 28px' }}>

        {/* ── Row 1: Customer + Warranty Company ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 20 }}>

          {/* Customer */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: '#f1f5f9', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Customer Information</span>
            </div>
            <div style={{ padding: '12px 14px' }}>
              {cell('Customer Name', contract.customerName)}
              {cell('Phone Number', contract.customerPhone)}
              {cell('Repair Order #', contract.repairOrder)}
            </div>
          </div>

          {/* Warranty Company */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: '#f1f5f9', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Warranty Company</span>
            </div>
            <div style={{ padding: '12px 14px' }}>
              {cell('Company Name', contract.warrantyCompany)}
              {cell('Phone Number', contract.warrantyPhone)}
              {cell('Claim Number', contract.claimNumber)}
            </div>
          </div>
        </div>

        {/* ── Row 2: Vehicle (full width so VIN has room) ── */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ background: '#f1f5f9', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Vehicle Information</span>
          </div>
          <div style={{ padding: '12px 14px' }}>
            {/* VIN full-width row */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>VIN Number</div>
              <div style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#0f172a', letterSpacing: 2, wordBreak: 'break-all', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 5, padding: '7px 10px' }}>
                {contract.vin || '—'}
              </div>
            </div>
            {/* Year / Make / Model / Mileage in 4 columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
              {cell('Year', contract.vehicleYear)}
              {cell('Make', contract.vehicleMake)}
              {cell('Model', contract.vehicleModel)}
              {cell('Mileage', contract.mileage ? Number(contract.mileage).toLocaleString() + ' mi' : '')}
            </div>
          </div>
        </div>

        {/* ── Labor ── */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ background: '#f1f5f9', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Labor</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {['Labor Rate', 'Labor Time', 'Diagnosis Time', 'Labor Total'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: i === 3 ? 'right' : 'left', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#0f172a' }}>${num(contract.laborRate).toFixed(2)} / hr</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#0f172a' }}>{num(contract.laborTime).toFixed(1)} hrs</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#0f172a' }}>{num(contract.diagnosisTime).toFixed(1)} hrs</td>
                <td style={{ padding: '10px 14px', fontSize: 14, fontWeight: 800, color: '#0f172a', textAlign: 'right' }}>{fmtDol(laborTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Parts ── */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ background: '#f1f5f9', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Parts</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left', borderBottom: '1px solid #e2e8f0', width: '20%' }}>Part Number</th>
                <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Description</th>
                <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center', borderBottom: '1px solid #e2e8f0', width: '8%' }}>Qty</th>
                <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right', borderBottom: '1px solid #e2e8f0', width: '13%' }}>Unit Price</th>
                <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right', borderBottom: '1px solid #e2e8f0', width: '13%' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(contract.parts || []).map((p, i) => {
                const qty = num(p.qty || 1);
                const lineTotal = qty * num(p.price);
                return (
                  <tr key={p.id || i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 1 ? '#fafafa' : '#fff' }}>
                    <td style={{ padding: '9px 14px', fontSize: 12, fontFamily: 'monospace', color: '#334155', wordBreak: 'break-all' }}>{p.partNumber || '—'}</td>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: '#0f172a' }}>{p.description || '—'}</td>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: '#334155', textAlign: 'center' }}>{qty}</td>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: '#475569', textAlign: 'right' }}>{fmtDol(num(p.price))}</td>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: '#0f172a', textAlign: 'right', fontWeight: 600 }}>{fmtDol(lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Financial Summary ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 20, alignItems: 'start' }}>

          {/* Tax detail (left) */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: '#f1f5f9', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Tax Calculation</span>
            </div>
            <div style={{ padding: '12px 14px' }}>
              {cell('Tax Rate', num(contract.taxPct) > 0 ? `${num(contract.taxPct)}%` : '—')}
              {cell('Parts Subtotal (taxable)', fmtDol(partsTotal))}
              {cell('Tax Amount', fmtDol(taxAmt))}
              {cell('Deductible', fmtDol(num(contract.deductible)))}
            </div>
          </div>

          {/* Totals (right) */}
          <div style={{ border: '2px solid #0f172a', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: '#0f172a', padding: '8px 14px' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#67e8f9', textTransform: 'uppercase', letterSpacing: 1 }}>Claim Summary</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  { label: 'Labor Total', value: fmtDol(laborTotal), bg: '#fff' },
                  { label: 'Parts Total', value: fmtDol(partsTotal), bg: '#f8fafc' },
                  { label: `Tax (${num(contract.taxPct) > 0 ? num(contract.taxPct) + '%' : '—'})`, value: fmtDol(taxAmt), bg: '#fff' },
                  rental > 0 && { label: 'Rental', value: fmtDol(rental), bg: '#f8fafc' },
                  towing > 0 && { label: 'Towing', value: fmtDol(towing), bg: '#fff' },
                  sublet > 0 && { label: 'Sublet', value: fmtDol(sublet), bg: '#f8fafc' },
                  { label: 'Deductible', value: `− ${fmtDol(num(contract.deductible))}`, bg: '#f8fafc' },
                ].filter(Boolean).map(row => (
                  <tr key={row.label} style={{ borderBottom: '1px solid #e2e8f0', background: row.bg }}>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: '#475569' }}>{row.label}</td>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: '#0f172a', textAlign: 'right', fontWeight: 600 }}>{row.value}</td>
                  </tr>
                ))}
                {/* Total Warranty Claim — highlighted */}
                <tr style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe' }}>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800, color: '#1e40af' }}>Total Warranty Claim</td>
                  <td style={{ padding: '11px 14px', fontSize: 15, fontWeight: 900, color: '#1e40af', textAlign: 'right' }}>{fmtDol(totalClaim)}</td>
                </tr>
                {/* Total Due by Customer — highlighted yellow */}
                <tr style={{ background: '#fefce8' }}>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800, color: '#92400e' }}>Total Due by Customer</td>
                  <td style={{ padding: '11px 14px', fontSize: 15, fontWeight: 900, color: '#b45309', textAlign: 'right' }}>{fmtDol(totalDue)}</td>
                </tr>
                {/* Repairs finished */}
                {contract.repairsFinished && (
                  <tr style={{ background: '#fef2f2' }}>
                    <td style={{ padding: '9px 14px', fontSize: 12, fontWeight: 700, color: '#b91c1c' }}>🔧 Repairs Finished</td>
                    <td style={{ padding: '9px 14px', fontSize: 12, fontWeight: 700, color: '#b91c1c', textAlign: 'right' }}>
                      {contract.repairsFinishedDate ? new Date(contract.repairsFinishedDate + 'T12:00:00').toLocaleDateString() : '—'}
                    </td>
                  </tr>
                )}
                {/* Payment date if paid */}
                {isPaid && contract.paymentDate && (
                  <tr style={{ background: '#f0fdf4' }}>
                    <td style={{ padding: '9px 14px', fontSize: 12, fontWeight: 700, color: '#15803d' }}>💳 Payment Received</td>
                    <td style={{ padding: '9px 14px', fontSize: 12, fontWeight: 700, color: '#15803d', textAlign: 'right' }}>{new Date(contract.paymentDate + 'T12:00:00').toLocaleDateString()}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Notes ── */}
        {contract.notes && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ background: '#f1f5f9', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Notes</span>
            </div>
            <div style={{ padding: '12px 14px', fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{contract.notes}</div>
          </div>
        )}

        {/* ── Signature Lines ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, marginTop: 32 }}>
          {['Advisor Signature', 'Customer Signature'].map(s => (
            <div key={s}>
              <div style={{ height: 40 }} />
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>{s}</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Date: ___________</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        <div style={{ marginTop: 24, paddingTop: 12, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>{contract.dealershipName} · Aftermarket Warranty Claim</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>Generated: {new Date().toLocaleDateString()}</div>
        </div>

      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function ContractLegend() {
  const pill = (bg, border, color, children) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 14, height: 14, borderRadius: 3, background: bg, border: `1px solid ${border}`, flexShrink: 0 }} />
      <span style={{ color, fontSize: 12 }}>{children}</span>
    </div>
  );
  const icon = (emoji, color, children) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 15, lineHeight: 1 }}>{emoji}</span>
      <span style={{ color, fontSize: 12, fontWeight: 600 }}>{children}</span>
    </div>
  );
  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.25)', padding: '10px 32px', minHeight: 0 }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>Legend</span>

        {/* Row color codes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {pill('rgba(239,68,68,0.18)',   'rgba(239,68,68,0.4)',   '#fca5a5', '🔧 Repairs Finished')}
          {pill('rgba(56,189,248,0.15)',  'rgba(56,189,248,0.4)',  '#7dd3fc', '📋 Ready for Submission')}
          {pill('rgba(34,197,94,0.18)',   'rgba(34,197,94,0.4)',   '#86efac', '✅ Approved Claim')}
          {pill('rgba(255,255,255,0.04)', 'rgba(255,255,255,0.08)','#64748b', 'No status set')}
          {icon('⏳', '#fbbf24', 'Waiting for Payment — label only')}
          {icon('💳', '#6ee7f9', 'Claim Paid — label only')}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

        {/* Status icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {icon('🔧', '#fca5a5', 'Repairs Finished')}
          {icon('⏳', '#fbbf24', 'Waiting for Payment')}
          {icon('💳', '#6ee7f9', 'Claim Paid')}
          {icon('✅', '#4ade80', 'Approved Claim')}
        </div>
      </div>
    </div>
  );
}

// ── Contract List ─────────────────────────────────────────────────────────────
function ContractList({ contracts, loading, onNew, onView }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Scrollable table area — minHeight:0 is required so flex doesn't prevent shrinking */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 32px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#64748b', padding: 60 }}>Loading contracts…</div>
          ) : contracts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🛡</div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>No contracts yet</div>
              <div style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>Click "New Contract" to create your first aftermarket warranty claim.</div>
              <button onClick={onNew} style={{ background: 'linear-gradient(135deg,rgba(61,214,195,0.3),rgba(110,231,249,0.2))', border: '1px solid rgba(61,214,195,0.4)', color: '#6ee7f9', borderRadius: 10, padding: '12px 28px', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
                + New Contract
              </button>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Repair Order', 'Date', 'Customer', 'Vehicle', 'Total Claim', 'Due by Customer', 'Claim Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => {
                  const { totalClaim, totalDue } = calcTotals(c);
                  const dateStr = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '—';
                  const isFinished  = !!c.repairsFinished;
                  const isApproved  = !!(c.approved ?? (c.status === 'approved'));
                  const isWaiting   = !!(c.waiting  ?? (c.status === 'waiting'));
                  const isPaid      = !!(c.paid     ?? (c.status === 'paid'));
                  const isReady     = !!c.readySubmission;
                  // Only the 3 exclusive buttons affect row background color
                  const rowBg = isApproved ? 'rgba(34,197,94,0.18)'
                    : isReady    ? 'rgba(56,189,248,0.15)'
                    : isFinished ? 'rgba(239,68,68,0.18)' : '';
                  const rowBgHover = isApproved ? 'rgba(34,197,94,0.28)'
                    : isReady    ? 'rgba(56,189,248,0.25)'
                    : isFinished ? 'rgba(239,68,68,0.28)' : 'rgba(255,255,255,0.04)';
                  const rowBorder = isApproved ? '1px solid rgba(34,197,94,0.4)'
                    : isReady    ? '1px solid rgba(56,189,248,0.4)'
                    : isFinished ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.05)';
                  const statusLabel = [
                    isPaid     && '💳 Claim Paid',
                    isWaiting  && '⏳ Waiting',
                    isApproved && '✅ Approved',
                    isReady    && '📋 Submission',
                    isFinished && '🔧 Ready',
                  ].filter(Boolean).join(' · ') || '';
                  return (
                    <tr key={c.id} onClick={() => onView(c)}
                      style={{ cursor: 'pointer', borderBottom: rowBorder, background: rowBg, transition: 'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = rowBgHover}
                      onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                      <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: 'monospace', color: '#6ee7f9' }}>{c.repairOrder || '—'}</td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b' }}>{dateStr}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{c.customerName || '—'}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#94a3b8' }}>{c.vehicleYear} {c.vehicleMake} {c.vehicleModel}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#3dd6c3', fontWeight: 700 }}>{fmtDol(totalClaim)}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#fbbf24', fontWeight: 700 }}>{fmtDol(totalDue)}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        {statusLabel
                          ? statusLabel.split(' · ').map(s => (
                              <div key={s} style={{ fontSize: 11, fontWeight: 700, color: s.includes('💳') ? '#6ee7f9' : s.includes('⏳') ? '#fbbf24' : s.includes('✅') ? '#4ade80' : s.includes('📋') ? '#7dd3fc' : '#fca5a5', whiteSpace: 'nowrap', lineHeight: 1.7 }}>{s}</div>
                            ))
                          : <span style={{ color: '#334155' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <span style={{ fontSize: 12, color: '#6ee7f9', fontWeight: 600, whiteSpace: 'nowrap' }}>View →</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Always-visible legend pinned at the bottom */}
      <ContractLegend />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AftermarketWarranty({ currentUser, currentRole, onBack, backLabel }) {
  const [view, setView] = useState('list');       // 'list' | 'form' | 'detail'
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeContract, setActiveContract] = useState(null);
  const [editingContract, setEditingContract] = useState(null);
  const [saveError, setSaveError] = useState('');
  const formRef = useRef(null);

  const loadContracts = useCallback(async () => {
    setLoading(true);
    try {
      const index = await loadWarrantyIndex();
      // index is array of full contract objects (we store full data in index for perf)
      setContracts(Array.isArray(index) ? index.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) : []);
    } catch {
      setContracts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadContracts(); }, [loadContracts]);

  async function handleSave(form) {
    setSaving(true); setSaveError('');
    try {
      // Build updated index (replace or add)
      const exists = contracts.findIndex(c => c.id === form.id);
      let newContracts;
      if (exists >= 0) {
        newContracts = contracts.map(c => c.id === form.id ? form : c);
      } else {
        newContracts = [form, ...contracts];
      }
      newContracts.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      await saveWarrantyContract(form, newContracts);
      setContracts(newContracts);
      setActiveContract(form);
      setView('detail');
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function handleNew() {
    setEditingContract(null);
    setView('form');
  }

  function handleView(c) {
    setActiveContract(c);
    setView('detail');
  }

  function handleEdit() {
    setEditingContract(activeContract);
    setView('form');
  }

  async function handleDelete() {
    if (!activeContract) return;
    if (!window.confirm(`Delete contract for ${activeContract.customerName || 'this customer'}? This cannot be undone.`)) return;
    setSaving(true); setSaveError('');
    try {
      const newContracts = contracts.filter(c => c.id !== activeContract.id);
      await saveWarrantyContract(activeContract, newContracts);
      setContracts(newContracts);
      setActiveContract(null);
      setView('list');
    } catch (err) {
      setSaveError(err.message || 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div className="adv-topbar no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button className="secondary" onClick={async () => {
          if (view === 'list') { onBack(); return; }
          if (view === 'form' && formRef.current) {
            await handleSave(formRef.current.getForm());
          } else {
            setView('list');
          }
        }}>
          {view === 'list' ? (backLabel || '← Back') : '← Contracts'}
        </button>
        <span style={{ fontWeight: 800, fontSize: 18, color: '#6ee7f9', flex: 1 }}>🛡 After Market Warranty</span>

        {view === 'list' && (
          <button onClick={handleNew}
            style={{ background: 'linear-gradient(135deg,rgba(61,214,195,0.3),rgba(110,231,249,0.2))', border: '1px solid rgba(61,214,195,0.4)', color: '#6ee7f9', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 700 }}>
            + New Contract
          </button>
        )}

        {saveError && <span style={{ color: '#f87171', fontSize: 13 }}>{saveError}</span>}
      </div>

      {/* Content */}
      {view === 'list' && (
        <ContractList contracts={contracts} loading={loading} onNew={handleNew} onView={handleView} />
      )}
      {view === 'form' && (
        <ContractForm
          ref={formRef}
          initial={editingContract}
          onSave={handleSave}
          onCancel={() => setView(activeContract ? 'detail' : 'list')}
          onDelete={editingContract ? handleDelete : null}
          saving={saving}
          currentRole={currentRole}
        />
      )}
      {view === 'detail' && activeContract && (
        <ContractDetail contract={activeContract} onEdit={handleEdit} onBack={() => setView('list')} />
      )}
    </div>
  );
}
