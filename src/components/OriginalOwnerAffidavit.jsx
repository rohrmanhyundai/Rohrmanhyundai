import React, { useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { AFFIDAVIT_PDF_B64 } from '../assets/originalOwnerPdfBase64';

const DEALER_CODE = 'IN007';
const SERVICE_MGR = 'Shawn Laughner';

// VIN boxes in left-to-right order (Text13..Text29)
const VIN_FIELDS = [
  'Text13','Text14','Text15','Text16','Text17','Text18','Text19',
  'Text20','Text21','Text22','Text23','Text24','Text25','Text26',
  'Text27','Text28','Text29',
];

const inpSt = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8, color: '#e2e8f0', padding: '9px 12px', fontSize: 14, outline: 'none',
};
const roSt = { ...inpSt, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#64748b' };
const labelSt = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };

function Field({ label, value, onChange, placeholder = '', readOnly = false, type = 'text' }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelSt}>{label}</label>
      <input type={type} value={value} readOnly={readOnly} placeholder={placeholder}
        onChange={e => onChange?.(e.target.value)}
        style={readOnly ? roSt : inpSt} />
    </div>
  );
}

export default function OriginalOwnerAffidavit({ onBack, backLabel }) {
  const today = new Date().toISOString().slice(0, 10);

  const [firstName,   setFirstName]   = useState('');
  const [lastName,    setLastName]    = useState('');
  const [customerDate, setCustomerDate] = useState(today);
  const [repairOrder, setRepairOrder] = useState('');
  const [repairDate,  setRepairDate]  = useState(today);
  const [vin,         setVin]         = useState('');
  const [generating,  setGenerating]  = useState(false);
  const [printing,    setPrinting]    = useState(false);
  const [error,       setError]       = useState('');

  const customerName = `${firstName.trim()} ${lastName.trim()}`.trim();

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  }

  function validate() {
    if (!firstName || !lastName) { setError('Please enter customer first and last name.'); return false; }
    if (!repairOrder)            { setError('Please enter a Repair Order number.'); return false; }
    if (vin.trim().length !== 17){ setError('VIN must be exactly 17 characters.'); return false; }
    setError('');
    return true;
  }

  async function buildFilledPdf() {
    const raw   = atob(AFFIDAVIT_PDF_B64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const pdfDoc    = await PDFDocument.load(bytes);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page      = pdfDoc.getPages()[0];
    const BLACK     = rgb(0, 0, 0);

    // Helper: draw text centered within a field rect [x0, y0, x1, y1]
    function drawCentered(text, x0, x1, y, size = 11) {
      const w = helvetica.widthOfTextAtSize(text, size);
      page.drawText(text, { x: (x0 + x1) / 2 - w / 2, y, size, font: helvetica, color: BLACK });
    }

    // ── Customer section ─────────────────────────────────────
    // Name field rect: [237.348, 574.8, 442.342, 600.84]
    drawCentered(customerName, 237.348, 442.342, 582);
    // Date field (Text11) rect: [452.42, 574.684, 555.817, 596.684]
    drawCentered(fmtDate(customerDate), 452.42, 555.817, 582);

    // ── Dealer section ───────────────────────────────────────
    // Dealer Code rect: [86.76, 398.64, 152.76, 424.68]
    drawCentered(DEALER_CODE, 86.76, 152.76, 407, 10);
    // RO Number rect: [282.24, 398.64, 375.72, 424.68]
    drawCentered(repairOrder, 282.24, 375.72, 407, 10);
    // Repair Date rect: [438.36, 398.64, 531.84, 424.68]
    drawCentered(fmtDate(repairDate), 438.36, 531.84, 407, 10);

    // ── VIN — one char per box ───────────────────────────────
    // Boxes sorted left→right, x positions from field rects
    const vinXPositions = [
      230.923, 248.082, 266.41, 284.504, 302.075, 320.17, 338.264,
      355.311, 373.406, 390.977, 408.548, 426.642, 444.445, 462.249,
      480.344, 498.438, 516.009,
    ];
    const vinStr = vin.trim().toUpperCase();
    vinXPositions.forEach((x0, i) => {
      if (vinStr[i]) drawCentered(vinStr[i], x0, x0 + 16.5, 380, 9);
    });

    // ── Manager section ──────────────────────────────────────
    // Name rect: [219.796, 301.56, 459.349, 327.6]
    drawCentered(SERVICE_MGR, 219.796, 459.349, 308);
    // Date rect: [461.476, 301.347, 560.684, 322.3]
    drawCentered(fmtDate(repairDate), 461.476, 560.684, 308);

    // Remove all form fields so nothing overlaps the drawn text
    const form = pdfDoc.getForm();
    form.getFields().forEach(f => {
      try { pdfDoc.getForm().removeField(f); } catch {}
    });

    return await pdfDoc.save();
  }

  async function handleDownload() {
    if (!validate()) return;
    setGenerating(true);
    try {
      const filled   = await buildFilledPdf();
      const blob     = new Blob([filled], { type: 'application/pdf' });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      a.href         = url;
      a.download     = `OriginalOwner_${lastName}_RO${repairOrder}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('PDF generation failed: ' + err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handlePrint() {
    if (!validate()) return;
    setPrinting(true);
    try {
      const filled = await buildFilledPdf();
      const blob   = new Blob([filled], { type: 'application/pdf' });
      const url    = URL.createObjectURL(blob);
      const win    = window.open(url, '_blank');
      if (win) {
        win.onload = () => { win.print(); };
      }
      // revoke after a delay to give the browser time to load it
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError('Print failed: ' + err.message);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button className="secondary" onClick={onBack}>{backLabel || '← Back'}</button>
        <span style={{ fontWeight: 800, fontSize: 18, color: '#6ee7f9', flex: 1 }}>
          📋 Original Owner Affidavit
        </span>
      </div>

      {/* Form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 60px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>

          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
            Fill in the fields below. The PDF will be auto-populated and downloaded ready to print.
          </div>

          {/* Customer info */}
          <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 800, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1.5, paddingBottom: 6, borderBottom: '1px solid rgba(61,214,195,0.2)', marginTop: 4 }}>
            Customer Information
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px', marginTop: 14 }}>
            <Field label="Customer First Name" value={firstName} onChange={setFirstName} placeholder="First" />
            <Field label="Customer Last Name"  value={lastName}  onChange={setLastName}  placeholder="Last" />
          </div>
          <Field label="Customer Date" value={customerDate} onChange={setCustomerDate} type="date" />

          {/* Vehicle */}
          <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 800, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1.5, paddingBottom: 6, borderBottom: '1px solid rgba(61,214,195,0.2)', marginTop: 20 }}>
            Vehicle & Repair
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label="VIN Number (17 characters)" value={vin}
              onChange={v => setVin(v.toUpperCase().slice(0, 17))}
              placeholder="17-digit VIN" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
              <Field label="Repair Order Number" value={repairOrder} onChange={setRepairOrder} placeholder="RO number" />
              <Field label="Repair Order Date"   value={repairDate}  onChange={setRepairDate}  type="date" />
            </div>
          </div>

          {/* Pre-filled / read-only */}
          <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 800, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1.5, paddingBottom: 6, borderBottom: '1px solid rgba(61,214,195,0.2)', marginTop: 20 }}>
            Dealer Information (Auto-Filled)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px', marginTop: 14 }}>
            <Field label="Dealer Code"           value={DEALER_CODE}  readOnly />
            <Field label="Service Manager Name"  value={SERVICE_MGR}  readOnly />
          </div>

          {/* VIN preview */}
          {vin.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {vin.padEnd(17, '_').split('').map((ch, i) => (
                <div key={i} style={{ width: 28, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ch === '_' ? 'rgba(255,255,255,0.03)' : 'rgba(61,214,195,0.12)', border: `1px solid ${ch === '_' ? 'rgba(255,255,255,0.08)' : 'rgba(61,214,195,0.35)'}`, borderRadius: 5, fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: ch === '_' ? '#334155' : '#3dd6c3' }}>
                  {ch === '_' ? '' : ch}
                </div>
              ))}
              <div style={{ width: '100%', fontSize: 11, color: '#475569', marginTop: 4 }}>{vin.length}/17 characters</div>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#f87171', fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <button
              onClick={handleDownload}
              disabled={generating || printing}
              style={{ background: 'linear-gradient(135deg,rgba(61,214,195,0.3),rgba(110,231,249,0.2))', border: '1px solid rgba(61,214,195,0.4)', color: '#6ee7f9', borderRadius: 10, padding: '14px 0', cursor: (generating || printing) ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 15, opacity: (generating || printing) ? 0.7 : 1 }}>
              {generating ? '⏳ Generating…' : '⬇ Download PDF'}
            </button>
            <button
              onClick={handlePrint}
              disabled={generating || printing}
              style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)', color: '#c4b5fd', borderRadius: 10, padding: '14px 0', cursor: (generating || printing) ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 15, opacity: (generating || printing) ? 0.7 : 1 }}>
              {printing ? '⏳ Opening…' : '🖨 Print PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
