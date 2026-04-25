import React, { useRef, useState } from 'react';

export default function OriginalOwnerForm({ onBack }) {
  const printRef = useRef(null);
  const [dealerCode,  setDealerCode]  = useState('');
  const [roNumber,    setRoNumber]    = useState('');
  const [repairDate,  setRepairDate]  = useState('');
  const [vin,         setVin]         = useState('');
  const [printing,    setPrinting]    = useState(false);

  // Format VIN into spaced groups for display (matches the form's dashed boxes)
  function fmtVin(v) {
    const clean = v.replace(/\s/g, '').toUpperCase();
    return clean.split('').join('  ');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  }

  function handlePrint() {
    const el = printRef.current;
    if (!el) return;
    setPrinting(true);
    el.style.display = 'block';

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; background: #fff; padding: 18mm 16mm; }
  h1.logo { font-size: 26pt; font-weight: 900; text-align: center; letter-spacing: -1px; margin-bottom: 6pt; }
  h2.title { font-size: 14pt; font-weight: 700; text-align: center; line-height: 1.4; margin-bottom: 20pt; }
  .section { border: 1.5px solid #000; margin-bottom: 12pt; }
  .section-header { background: #000; color: #fff; text-align: center; font-size: 9pt; font-weight: 700; padding: 4pt 8pt; letter-spacing: 0.5px; text-transform: uppercase; }
  .section-body { padding: 10pt 12pt; }
  .cert-text { font-size: 10.5pt; line-height: 1.6; margin-bottom: 16pt; }
  .sig-row { display: flex; gap: 16pt; margin-top: 4pt; }
  .sig-block { flex: 1; border-top: 1px solid #000; padding-top: 4pt; font-size: 9pt; color: #333; }
  .sig-block.narrow { flex: 0 0 120pt; }
  .dealer-row { display: flex; gap: 24pt; align-items: baseline; margin-bottom: 10pt; flex-wrap: wrap; }
  .dealer-field { font-size: 10.5pt; }
  .dealer-field span { display: inline-block; min-width: 80pt; border-bottom: 1px solid #000; padding: 0 4pt; font-weight: 700; }
  .vin-row { font-size: 10.5pt; margin-bottom: 10pt; }
  .vin-value { font-family: 'Courier New', monospace; font-size: 11pt; font-weight: 700; letter-spacing: 3px; border-bottom: 1px solid #000; display: inline-block; min-width: 300pt; padding: 0 4pt; }
  .cert-italic { font-style: italic; font-size: 9.5pt; line-height: 1.5; margin-bottom: 14pt; }
  .info-header { text-align: center; font-size: 9pt; font-weight: 700; letter-spacing: 0.5px; border-bottom: 1px solid #ccc; padding-bottom: 5pt; margin-bottom: 8pt; text-transform: uppercase; }
  .info-body { font-size: 9.5pt; line-height: 1.7; }
  .info-body p { margin-bottom: 6pt; }
  .info-body ol { padding-left: 18pt; }
  .note { font-size: 10pt; font-weight: 700; margin: 8pt 0 4pt; }
  .note-bullets { font-size: 9.5pt; line-height: 1.7; padding-left: 12pt; }
  .form-code { font-size: 8pt; color: #555; text-align: right; margin-top: 20pt; }
  @media print { @page { size: letter portrait; margin: 0; } body { padding: 14mm 14mm; } }
</style>
</head><body>
  <!-- Logo -->
  <h1 class="logo">&#9419; HYUNDAI</h1>
  <h2 class="title">10 Years/100,000 Miles Powertrain Limited Warranty<br>Original Owner Verification Affidavit</h2>

  <!-- Section 1: Customer -->
  <div class="section">
    <div class="section-header">Current Owner/Customer Certification &ndash; To Be Completed by the Customer</div>
    <div class="section-body">
      <div class="cert-text">
        I hereby certify that I am the original owner.<br>
        I further certify that the vehicle is not being used for commercial purposes.
      </div>
      <div style="margin-bottom: 18pt;">&nbsp;</div>
      <div class="sig-row">
        <div class="sig-block">Current Owner Signature</div>
        <div class="sig-block">Name (print or type)</div>
        <div class="sig-block narrow">Date</div>
      </div>
      <div class="note">Note: <span style="font-weight:400">Current Owner must be the original owner.</span></div>
      <div style="margin-top:8pt;">
        <div class="note">Please note the following:</div>
        <div class="note-bullets">
          &ndash; Subsequent owners of the vehicle are not eligible for the 10 years/100,000 Miles Powertrain Limited Warranty.<br>
          &ndash; Parts that fall under the <strong><u>Hybrid</u></strong> and/or <strong><u>Emission</u></strong> Warranty Coverages do not require an affidavit.
        </div>
      </div>
    </div>
  </div>

  <!-- Section 2: Dealership -->
  <div class="section">
    <div class="section-header">Dealership Verification &ndash; To Be Completed by the Dealer</div>
    <div class="section-body">
      <div class="dealer-row">
        <div class="dealer-field">Dealer Code: <span>${dealerCode || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</span></div>
        <div class="dealer-field">Repair Order (RO) Number: <span>${roNumber || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</span></div>
        <div class="dealer-field">Repair Date: <span>${repairDate ? fmtDate(repairDate) : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</span></div>
      </div>
      <div class="vin-row">
        17-Digit Vehicle Identification Number (VIN):&nbsp;&nbsp;
        <span class="vin-value">${vin ? fmtVin(vin) : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</span>
      </div>
      <div class="cert-italic">
        I have reviewed Hyundai Motor America (HMA) current Warranty Policy &amp; Procedures Manual and/or 10 Years/100,000 Miles
        Powertrain Warranty Original Owner Verification Guidelines. I certify that the Hyundai vehicle identified above is eligible for the
        10 Years/100,000 Miles Powertrain Warranty under HMA published warranty coverage guidelines.
      </div>
      <div style="margin-bottom:18pt;">&nbsp;</div>
      <div class="sig-row">
        <div class="sig-block">Dealer Service Manager Signature</div>
        <div class="sig-block">Name (print or type)</div>
        <div class="sig-block narrow">Date</div>
      </div>
    </div>
  </div>

  <!-- Section 3: Submission Criteria -->
  <div style="border:1px solid #000; padding: 8pt 12pt;">
    <div class="info-header">Powertrain Warranty Claims Submission Criteria to Hyundai Dealers</div>
    <div class="info-body">
      <p>During the write-up process, prior to repair and warranty claim submission, dealer must execute the Hyundai 10 Years/100,000 Miles Powertrain Limited Warranty Original Owner Verification Affidavit. The completed affidavit form <u>must be</u> attached to the respective Repair Order (RO), along with the documents listed below, and retained in the dealer vehicle files. HMA reserves the right to request said documentation and, if the documents are not made available to HMA or are incomplete, a warranty claim debit may be issued at HMA&rsquo;s discretion.</p>
      <p>Attach the following to this completed form and retain in the vehicle file:</p>
      <ol>
        <li>A photocopy of the Current Owner/Customer&rsquo;s DMV registration form</li>
        <li>A printout of the Warranty Vehicle Information Screen</li>
      </ol>
    </div>
  </div>

  <div class="form-code">SVC-1248 08/17<br>(PREVIOUSLY NP170-09000 2/04)</div>
</body></html>`);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
        el.style.display = 'none';
        setPrinting(false);
      }, 2000);
    }, 400);
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

  const filled = dealerCode || roNumber || repairDate || vin;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Print CSS */}
      <style>{`.oof-print-doc { display: none; }`}</style>

      {/* Top bar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button className="secondary" onClick={onBack}>← Back</button>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: '#6ee7f9' }}>
          Original Owner Verification Affidavit
        </span>
        <button
          onClick={handlePrint}
          disabled={printing}
          style={{
            background: 'linear-gradient(135deg,rgba(61,214,195,0.2),rgba(110,231,249,0.15))',
            border: '1px solid rgba(61,214,195,0.4)',
            color: '#3dd6c3',
            borderRadius: 8,
            padding: '8px 22px',
            fontWeight: 700,
            fontSize: 14,
            cursor: printing ? 'not-allowed' : 'pointer',
            opacity: printing ? 0.6 : 1,
          }}
        >
          {printing ? '⏳ Printing…' : '🖨 Print Form'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 60px', display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* ── Input Panel ── */}
        <div style={{ flex: '0 0 340px', minWidth: 280 }}>
          <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: '24px 24px 28px' }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#6ee7f9', marginBottom: 4 }}>Dealership Information</div>
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 24 }}>Fill in the dealer section — the form auto-fills and is ready to print.</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              <div>
                <label style={labelStyle}>Dealer Code</label>
                <input
                  style={inputStyle}
                  value={dealerCode}
                  onChange={e => setDealerCode(e.target.value)}
                  placeholder="e.g. 38147"
                  maxLength={20}
                />
              </div>

              <div>
                <label style={labelStyle}>Repair Order (RO) Number</label>
                <input
                  style={inputStyle}
                  value={roNumber}
                  onChange={e => setRoNumber(e.target.value)}
                  placeholder="e.g. 776889"
                  maxLength={30}
                />
              </div>

              <div>
                <label style={labelStyle}>Repair Date</label>
                <input
                  type="date"
                  style={inputStyle}
                  value={repairDate}
                  onChange={e => setRepairDate(e.target.value)}
                />
              </div>

              <div>
                <label style={labelStyle}>
                  17-Digit VIN
                  {vin && <span style={{ marginLeft: 8, color: vin.replace(/\s/g,'').length === 17 ? '#86efac' : '#f59e0b', fontWeight: 700 }}>
                    ({vin.replace(/\s/g,'').length}/17)
                  </span>}
                </label>
                <input
                  style={{
                    ...inputStyle,
                    fontFamily: 'monospace',
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                    borderColor: vin && vin.replace(/\s/g,'').length !== 17
                      ? 'rgba(245,158,11,.5)'
                      : vin.replace(/\s/g,'').length === 17
                        ? 'rgba(34,197,94,.4)'
                        : 'rgba(255,255,255,.15)',
                  }}
                  value={vin}
                  onChange={e => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="17-character VIN"
                  maxLength={17}
                />
                {vin && vin.length < 17 && (
                  <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>VIN must be 17 characters</div>
                )}
              </div>

            </div>

            <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.08)' }}>
              <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.7 }}>
                <strong style={{ color: '#94a3b8' }}>After printing, attach:</strong><br />
                1. Copy of customer's DMV registration<br />
                2. Warranty Vehicle Information Screen printout
              </div>
            </div>
          </div>
        </div>

        {/* ── Live Preview ── */}
        <div style={{ flex: 1, minWidth: 400 }}>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📋</span> Live preview — updates as you type
          </div>
          <div style={{
            background: '#fff',
            color: '#000',
            borderRadius: 12,
            padding: '24px 28px',
            fontFamily: 'Arial, sans-serif',
            fontSize: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,.4)',
            maxWidth: 680,
          }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: -0.5 }}>&#9419; HYUNDAI</div>
              <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.4, marginTop: 4 }}>
                10 Years/100,000 Miles Powertrain Limited Warranty<br />
                Original Owner Verification Affidavit
              </div>
            </div>

            {/* Customer section */}
            <div style={{ border: '1.5px solid #000', marginBottom: 8 }}>
              <div style={{ background: '#000', color: '#fff', textAlign: 'center', fontSize: 7, fontWeight: 700, padding: '3px 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Current Owner/Customer Certification – To Be Completed by the Customer
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 9, lineHeight: 1.6, marginBottom: 10 }}>
                  I hereby certify that I am the original owner.<br />
                  I further certify that the vehicle is not being used for commercial purposes.
                </div>
                <div style={{ marginBottom: 12 }}>&nbsp;</div>
                <div style={{ display: 'flex', gap: 12, borderTop: '1px solid #000' }}>
                  <div style={{ flex: 1, fontSize: 7, color: '#444', paddingTop: 3 }}>Current Owner Signature</div>
                  <div style={{ flex: 1, fontSize: 7, color: '#444', paddingTop: 3 }}>Name (print or type)</div>
                  <div style={{ fontSize: 7, color: '#444', paddingTop: 3, whiteSpace: 'nowrap' }}>Date</div>
                </div>
                <div style={{ marginTop: 8, fontSize: 8 }}>
                  <strong>Note:</strong> Current Owner must be the original owner.
                </div>
                <div style={{ marginTop: 4, fontSize: 8 }}>
                  <strong>Please note the following:</strong><br />
                  <span style={{ paddingLeft: 8 }}>– Subsequent owners of the vehicle are not eligible for the 10 years/100,000 Miles Powertrain Limited Warranty.</span><br />
                  <span style={{ paddingLeft: 8 }}>– Parts that fall under the <strong><u>Hybrid</u></strong> and/or <strong><u>Emission</u></strong> Warranty Coverages do not require an affidavit.</span>
                </div>
              </div>
            </div>

            {/* Dealer section */}
            <div style={{ border: '1.5px solid #000', marginBottom: 8 }}>
              <div style={{ background: '#000', color: '#fff', textAlign: 'center', fontSize: 7, fontWeight: 700, padding: '3px 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Dealership Verification – To Be Completed by the Dealer
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap', fontSize: 9, alignItems: 'baseline' }}>
                  <div>Dealer Code: <span style={{ fontWeight: 700, borderBottom: '1px solid #000', minWidth: 60, display: 'inline-block', padding: '0 3px' }}>{dealerCode || '     '}</span></div>
                  <div>Repair Order (RO) Number: <span style={{ fontWeight: 700, borderBottom: '1px solid #000', minWidth: 80, display: 'inline-block', padding: '0 3px' }}>{roNumber || '     '}</span></div>
                  <div>Repair Date: <span style={{ fontWeight: 700, borderBottom: '1px solid #000', minWidth: 60, display: 'inline-block', padding: '0 3px' }}>{repairDate ? fmtDate(repairDate) : '     '}</span></div>
                </div>
                <div style={{ fontSize: 9, marginBottom: 8 }}>
                  17-Digit Vehicle Identification Number (VIN):&nbsp;
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 2, borderBottom: '1px solid #000', display: 'inline-block', minWidth: 200, padding: '0 3px', color: vin ? '#000' : '#999' }}>
                    {vin ? fmtVin(vin) : '_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _'}
                  </span>
                </div>
                <div style={{ fontStyle: 'italic', fontSize: 8, lineHeight: 1.5, marginBottom: 10, color: '#222' }}>
                  I have reviewed Hyundai Motor America (HMA) current Warranty Policy & Procedures Manual and/or 10 Years/100,000 Miles
                  Powertrain Warranty Original Owner Verification Guidelines. I certify that the Hyundai vehicle identified above is eligible for the
                  10 Years/100,000 Miles Powertrain Warranty under HMA published warranty coverage guidelines.
                </div>
                <div style={{ marginBottom: 12 }}>&nbsp;</div>
                <div style={{ display: 'flex', gap: 12, borderTop: '1px solid #000' }}>
                  <div style={{ flex: 1, fontSize: 7, color: '#444', paddingTop: 3 }}>Dealer Service Manager Signature</div>
                  <div style={{ flex: 1, fontSize: 7, color: '#444', paddingTop: 3 }}>Name (print or type)</div>
                  <div style={{ fontSize: 7, color: '#444', paddingTop: 3, whiteSpace: 'nowrap' }}>Date</div>
                </div>
              </div>
            </div>

            {/* Submission criteria */}
            <div style={{ border: '1px solid #000', padding: '6px 10px' }}>
              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 7, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #ccc', paddingBottom: 4, marginBottom: 6 }}>
                Powertrain Warranty Claims Submission Criteria to Hyundai Dealers
              </div>
              <div style={{ fontSize: 7.5, lineHeight: 1.7, color: '#222' }}>
                <p style={{ marginBottom: 5 }}>
                  During the write-up process, prior to repair and warranty claim submission, dealer must execute the Hyundai 10 Years/100,000 Miles Powertrain Limited Warranty Original Owner Verification Affidavit. The completed affidavit form <u>must be</u> attached to the respective Repair Order (RO), along with the documents listed below, and retained in the dealer vehicle files.
                </p>
                <p style={{ marginBottom: 5 }}>Attach the following to this completed form and retain in the vehicle file:</p>
                <div style={{ paddingLeft: 12 }}>
                  1. A photocopy of the Current Owner/Customer's DMV registration form<br />
                  2. A printout of the Warranty Vehicle Information Screen
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'right', fontSize: 7, color: '#888', marginTop: 10 }}>SVC-1248 08/17 (PREVIOUSLY NP170-09000 2/04)</div>
          </div>

          {!filled && (
            <div style={{ marginTop: 16, fontSize: 12, color: '#334155', fontStyle: 'italic', textAlign: 'center' }}>
              Enter dealer information on the left to fill the form ←
            </div>
          )}
        </div>
      </div>

      {/* Hidden element for print reference (not used — iframe approach above) */}
      <div ref={printRef} className="oof-print-doc" />
    </div>
  );
}
