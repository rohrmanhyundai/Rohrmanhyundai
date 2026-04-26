import React, { useState } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Coordinates use percentage of actual page size so they work regardless of
// whether the scanned PDF is Letter, A4, or any other size.
// xPct = fraction from LEFT edge, yPct = fraction from TOP edge.
// Tweak these if any field still lands off after testing.

const FIELDS = {
  dealerCode:   { x: 0.195, y: 0.505 },  // after "Dealer Code: "
  roNumber:     { x: 0.490, y: 0.505 },  // after "Repair Order (RO) Number: "
  repairDate:   { x: 0.762, y: 0.505 },  // after "Repair Date: "
  vin:          { x: 0.455, y: 0.528 },  // after "17-Digit Vehicle Identification Number (VIN): "
  customerDate: { x: 0.840, y: 0.275 },  // Date field on customer signature line
  managerDate:  { x: 0.840, y: 0.748 },  // Date field on dealer manager signature line
};

const TEXT_SIZE = 9;

export default function OriginalOwnerForm({ onBack }) {
  const [dealerCode,    setDealerCode]    = useState('');
  const [roNumber,      setRoNumber]      = useState('');
  const [repairDate,    setRepairDate]    = useState('');
  const [vin,           setVin]           = useState('');
  const [customerDate,  setCustomerDate]  = useState('');
  const [managerDate,   setManagerDate]   = useState('');
  const [busy,          setBusy]          = useState(false);

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  }

  // Space out VIN characters to align with the dash boxes on the printed form
  function fmtVin(v) {
    return v.replace(/\s/g, '').split('').join('  ');
  }

  async function handleGenerate(action) {
    setBusy(true);
    try {
      const base = import.meta.env.BASE_URL || '/';
      const url  = `${base}original-owner-affidavit.pdf`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`Could not load PDF (${res.status})`);
      const existingPdfBytes = await res.arrayBuffer();

      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const page   = pdfDoc.getPages()[0];

      // Log actual page size to console (helpful for re-calibration)
      const { width: pw, height: ph } = page.getSize();
      console.log(`PDF page size: ${pw.toFixed(1)} × ${ph.toFixed(1)} pts`);

      const drawAt = (text, fieldKey) => {
        if (!text) return;
        const f = FIELDS[fieldKey];
        page.drawText(text, {
          x: pw * f.x,
          y: ph * (1 - f.y),
          size: TEXT_SIZE,
          font,
          color: rgb(0, 0, 0),
        });
      };

      // Dealership fields
      drawAt(dealerCode,           'dealerCode');
      drawAt(roNumber,             'roNumber');
      drawAt(fmtDate(repairDate),  'repairDate');
      drawAt(fmtVin(vin),          'vin');

      // Signature dates
      drawAt(fmtDate(customerDate), 'customerDate');
      drawAt(fmtDate(managerDate),  'managerDate');

      const filledBytes = await pdfDoc.save();
      const blob        = new Blob([filledBytes], { type: 'application/pdf' });
      const blobUrl     = URL.createObjectURL(blob);

      if (action === 'print') {
        const w = window.open(blobUrl, '_blank');
        if (w) w.addEventListener('load', () => { w.focus(); w.print(); });
      } else {
        const a = document.createElement('a');
        a.href     = blobUrl;
        a.download = `OriginalOwnerAffidavit_RO${roNumber || 'form'}.pdf`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(blobUrl); document.body.removeChild(a); }, 1000);
      }
    } catch (err) {
      alert('Error generating PDF: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.15)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 14,
    padding: '10px 14px',
    width: '100%',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };
  const labelStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '.06em',
    marginBottom: 6,
    display: 'block',
  };

  const vinClean = vin.replace(/\s/g, '');
  const vinOk    = vinClean.length === 17;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

      {/* ── Top bar ── */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button className="secondary" onClick={onBack}>← Back</button>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: '#6ee7f9' }}>
          Original Owner Verification Affidavit
        </span>
        <button
          onClick={() => handleGenerate('print')}
          disabled={busy}
          style={{
            background: 'rgba(148,163,184,.12)', border: '1px solid rgba(148,163,184,.3)',
            color: '#94a3b8', borderRadius: 8, padding: '8px 20px',
            fontWeight: 700, fontSize: 14,
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
          }}
        >
          🖨 Print
        </button>
        <button
          onClick={() => handleGenerate('download')}
          disabled={busy}
          style={{
            background: 'linear-gradient(135deg,rgba(61,214,195,.2),rgba(110,231,249,.15))',
            border: '1px solid rgba(61,214,195,.4)', color: '#3dd6c3',
            borderRadius: 8, padding: '8px 20px', fontWeight: 700, fontSize: 14,
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? '⏳ Generating…' : '⬇ Download PDF'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px', display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* ── Input Panel ── */}
        <div style={{ flex: '0 0 360px', minWidth: 300 }}>
          <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: '24px 24px 28px' }}>

            {/* Dealership section */}
            <div style={{ fontWeight: 800, fontSize: 14, color: '#6ee7f9', marginBottom: 4 }}>Dealership Information</div>
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 20 }}>Fills the Dealership Verification section</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle}>Dealer Code</label>
                <input style={inputStyle} value={dealerCode} onChange={e => setDealerCode(e.target.value)} placeholder="e.g. 38147" maxLength={20} />
              </div>

              <div>
                <label style={labelStyle}>Repair Order (RO) Number</label>
                <input style={inputStyle} value={roNumber} onChange={e => setRoNumber(e.target.value)} placeholder="e.g. 776889" maxLength={30} />
              </div>

              <div>
                <label style={labelStyle}>Repair Date</label>
                <input type="date" style={inputStyle} value={repairDate} onChange={e => setRepairDate(e.target.value)} />
              </div>

              <div>
                <label style={labelStyle}>
                  17-Digit VIN
                  {vin && (
                    <span style={{ marginLeft: 8, color: vinOk ? '#86efac' : '#f59e0b', fontWeight: 700 }}>
                      ({vinClean.length}/17){vinOk ? ' ✓' : ''}
                    </span>
                  )}
                </label>
                <input
                  style={{
                    ...inputStyle,
                    fontFamily: 'monospace', letterSpacing: 2, textTransform: 'uppercase',
                    borderColor: vin && !vinOk ? 'rgba(245,158,11,.5)' : vinOk ? 'rgba(34,197,94,.4)' : 'rgba(255,255,255,.15)',
                  }}
                  value={vin}
                  onChange={e => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="17-character VIN"
                  maxLength={17}
                />
                {vin && !vinOk && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>VIN must be exactly 17 characters</div>}
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '24px 0' }} />

            {/* Signature dates */}
            <div style={{ fontWeight: 800, fontSize: 14, color: '#a5b4fc', marginBottom: 4 }}>Signature Dates</div>
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 20 }}>Fills the Date field on each signature line</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle}>Customer Date</label>
                <input type="date" style={inputStyle} value={customerDate} onChange={e => setCustomerDate(e.target.value)} />
              </div>

              <div>
                <label style={labelStyle}>Dealer Service Manager Date</label>
                <input type="date" style={inputStyle} value={managerDate} onChange={e => setManagerDate(e.target.value)} />
              </div>
            </div>

            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.08)', fontSize: 12, color: '#475569', lineHeight: 1.7 }}>
              <strong style={{ color: '#94a3b8' }}>After printing, attach:</strong><br />
              1. Copy of customer's DMV registration<br />
              2. Warranty Vehicle Information Screen printout
            </div>
          </div>
        </div>

        {/* ── Info Panel ── */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 16, padding: '24px 28px', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#a5b4fc', marginBottom: 16 }}>📄 How This Works</div>
            <ol style={{ color: '#94a3b8', fontSize: 13, lineHeight: 2.1, paddingLeft: 20 }}>
              <li>Fill in the fields on the left.</li>
              <li>Click <strong style={{ color: '#3dd6c3' }}>⬇ Download PDF</strong> to get the official Hyundai form with your info typed in.</li>
              <li>The <strong style={{ color: '#e2e8f0' }}>Customer</strong> signs the top section.</li>
              <li>The <strong style={{ color: '#e2e8f0' }}>Service Manager</strong> signs the dealership section.</li>
              <li>Attach to the RO and retain in the vehicle file.</li>
            </ol>
          </div>

          <div style={{ background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 12, padding: '14px 18px', fontSize: 12, color: '#92400e', lineHeight: 1.7 }}>
            <strong style={{ color: '#fbbf24' }}>⚠ Reminder:</strong> Required for all 10-Year/100,000-Mile Powertrain Warranty claims. HMA may request this document and may issue a claim debit if missing or incomplete.
          </div>
        </div>
      </div>
    </div>
  );
}
