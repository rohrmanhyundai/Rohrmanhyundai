import React, { useState, useEffect } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DCT_MTM_PDF_B64 } from '../assets/dctMtmPdfBase64';
import { loadGithubFile, saveGithubFile, getGithubToken } from '../utils/github';

const DEALER_CODE = 'IN007';

const inp = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13, outline: 'none',
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
};
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const section = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 };
const sectionTitle = { fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 };

function Field({ label, value, onChange, placeholder = '', type = 'text', readOnly = false }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type={type} value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} readOnly={readOnly}
        style={{ ...inp, ...(readOnly ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }} />
    </div>
  );
}

function CheckRow({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
      <span style={{ fontSize: 13, color: '#cbd5e1', minWidth: 120 }}>{label}</span>
      {options.map(opt => (
        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13, color: value === opt ? '#6ee7b7' : '#64748b', fontWeight: value === opt ? 700 : 400 }}>
          <input type="radio" name={label} value={opt} checked={value === opt} onChange={() => onChange(opt)}
            style={{ accentColor: '#6ee7b7' }} />
          {opt}
        </label>
      ))}
    </div>
  );
}

const GEARS = ['1st Gear','2nd Gear','3rd Gear','4th Gear','5th Gear','6th Gear','7th Gear','8th Gear','Clutch 1 Judder','Clutch 2 Judder'];

const CONDITION_CODES = [
  { group: 'SLIPS', codes: [
    { code: '400', desc: 'Slips in Reverse' },
    { code: '401', desc: 'Slips in Drive' },
    { code: '402', desc: 'Slips in 1st gear' },
    { code: '403', desc: 'Slips in 2nd gear' },
    { code: '404', desc: 'Slips in 3rd gear' },
    { code: '405', desc: 'Slips in 4th gear' },
    { code: '406', desc: 'Slips in 5th gear' },
    { code: '407', desc: 'Slips other gear (specify)' },
  ]},
  { group: 'GRINDING', codes: [
    { code: '410', desc: 'Grinds into 1st' },
    { code: '411', desc: 'Grinds into 2nd' },
    { code: '412', desc: 'Grinds into 3rd' },
    { code: '413', desc: 'Grinds into 4th' },
    { code: '414', desc: 'Grinds into 5th' },
    { code: '415', desc: 'Grinds into 6th' },
    { code: '416', desc: 'Grinds into 7th' },
    { code: '417', desc: 'Grinds into reverse' },
    { code: '418', desc: 'Grinds - Other (specify)' },
  ]},
  { group: 'SHIFT JUDDER', codes: [
    { code: '420', desc: 'Shudder into Drive' },
    { code: '421', desc: 'Shudder into Reverse' },
    { code: '422', desc: 'Shudder 1-2 shift' },
    { code: '423', desc: 'Shudder 2-3 shift' },
    { code: '424', desc: 'Shudder 3-4 shift' },
    { code: '425', desc: 'Shudder 4-5 shift' },
    { code: '426', desc: 'Shudder during acceleration from stop' },
    { code: '427', desc: 'Shudder - Other (specify)' },
  ]},
  { group: 'SHIFTS ERRATIC / UP OR DOWN TOO OFTEN', codes: [
    { code: '430', desc: 'Erratic upshift (specify)' },
    { code: '431', desc: 'Erratic downshift (specify)' },
    { code: '432', desc: 'Erratic shift - other (specify)' },
  ]},
  { group: 'CHECK ENGINE LIGHT ON', codes: [
    { code: '440', desc: 'Check engine light on — "Engine" menu (specify DTC)' },
    { code: '441', desc: 'Check engine light on — "Trans" menu (specify DTC)' },
  ]},
  { group: 'LEAKS', codes: [
    { code: '450', desc: 'Leaks at bellhousing' },
    { code: '451', desc: 'Leaks at case (specify location)' },
    { code: '452', desc: 'Leaks at differential oil seal (specify left or right)' },
    { code: '453', desc: 'Leaks between transaxle and transfer case' },
    { code: '454', desc: 'Leaks between case halves' },
    { code: '455', desc: 'Leaks at rear cover' },
    { code: '456', desc: 'Oil leak due to crack in case (specify location)' },
    { code: '457', desc: 'Other leak (specify)' },
  ]},
  { group: 'CASE BROKEN / CRACKED', codes: [
    { code: '460', desc: 'Bellhousing broken/cracked (specify location)' },
    { code: '461', desc: 'Transaxle case broken/cracked (specify location)' },
  ]},
  { group: 'WILL NOT MOVE', codes: [
    { code: '470', desc: 'Will not move in Reverse' },
    { code: '471', desc: 'Will not move in Drive / No forward gears' },
  ]},
  { group: 'SHIFTS HARSH or ROUGH / BANGS / JERKS', codes: [
    { code: '480', desc: 'Harsh shift in Drive' },
    { code: '481', desc: 'Harsh shift into Reverse' },
    { code: '482', desc: 'Harsh upshift (specify gears)' },
    { code: '483', desc: 'Harsh downshift (specify gears)' },
  ]},
  { group: 'DELAYED SHIFT', codes: [
    { code: '490', desc: 'Delayed shift into Drive' },
    { code: '491', desc: 'Delayed shift into Reverse' },
    { code: '492', desc: 'Delayed upshift (specify gears)' },
    { code: '493', desc: 'Delayed downshift (specify gears)' },
  ]},
  { group: "WON'T SHIFT / STUCK IN GEAR", codes: [
    { code: '500', desc: "Won't shift in Drive" },
    { code: '501', desc: 'Stuck in 1st gear' },
    { code: '502', desc: 'Stuck in 2nd gear (specify DTC)' },
    { code: '503', desc: 'Stuck in 3rd gear (specify DTC)' },
    { code: '504', desc: 'Stuck in 4th gear (specify DTC)' },
    { code: '505', desc: 'Stuck in 5th gear (specify DTC)' },
    { code: '506', desc: 'Stuck in 6th gear (specify DTC)' },
    { code: '507', desc: 'Stuck in 7th gear (specify DTC)' },
    { code: '508', desc: "Won't shift - other (specify)" },
  ]},
  { group: 'NOISE', codes: [
    { code: '520', desc: 'Noise in 1st gear' },
    { code: '521', desc: 'Noise in 2nd gear' },
    { code: '522', desc: 'Noise in 3rd gear' },
    { code: '523', desc: 'Noise in 4th gear' },
    { code: '524', desc: 'Noise in 5th gear' },
    { code: '525', desc: 'Noise in 6th gear' },
    { code: '526', desc: 'Noise in 7th gear' },
    { code: '527', desc: 'Noise in reverse' },
    { code: '528', desc: 'Noise during acceleration/deceleration' },
    { code: '529', desc: 'Whine noise (specify road speed)' },
    { code: '528', desc: 'Noise from differential (specify road speed)' },
    { code: '529', desc: 'Noise - other (specify)' },
  ]},
];

export default function DCTMTMWorksheet({ onBack, currentUser, currentRole }) {
  const today = new Date().toISOString().slice(0, 10);

  const [ro,            setRo]            = useState('');
  const [dealerCode,    setDealerCode]    = useState(DEALER_CODE);
  const [techName,      setTechName]      = useState(currentUser || '');
  const [repairDate,    setRepairDate]    = useState(today);
  const [mileage,       setMileage]       = useState('');
  const [vin,           setVin]           = useState('');
  const [repairType,    setRepairType]    = useState(''); // 'Warranty' | 'Customer Pay'
  const [removedPN,     setRemovedPN]     = useState('');
  const [removedSN,     setRemovedSN]     = useState('');
  const [installedPN,   setInstalledPN]   = useState('');
  const [installedSN,   setInstalledSN]   = useState('');
  const [conditionCode, setConditionCode] = useState('');

  // Symptom
  const [specificCondition, setSpecificCondition] = useState('');
  const [howLong,           setHowLong]           = useState('');
  const [howOften,          setHowOften]          = useState(''); // Always/Sometimes/Intermittent
  const [whenHotCold,       setWhenHotCold]        = useState(''); // Hot/Cold
  const [beenInBefore,      setBeenInBefore]       = useState(''); // Yes/No
  const [checkedTSB,        setCheckedTSB]         = useState(''); // Yes/No
  const [canDuplicate,      setCanDuplicate]       = useState(''); // Yes/No
  const [howDuplicate,      setHowDuplicate]       = useState('');
  const [testDriveResults,  setTestDriveResults]   = useState('');

  // Fluid
  const [fluidLevel,  setFluidLevel]  = useState('');
  const [fluidSmell,  setFluidSmell]  = useState('');
  const [fluidColor,  setFluidColor]  = useState('');
  const [leakLocation,setLeakLocation]= useState('');
  const [gdsCode1,    setGdsCode1]    = useState('');
  const [gdsCode2,    setGdsCode2]    = useState('');
  const [ecmLevel,    setEcmLevel]    = useState('');
  const [tcmLevel,    setTcmLevel]    = useState('');

  // Gear results: { '1st Gear': 'OK' | 'SLIPS' | 'GRINDS' | '' }
  const [gearResults, setGearResults] = useState(() => Object.fromEntries(GEARS.map(g => [g, ''])));

  // Driveability
  const [tpsIdle,     setTpsIdle]     = useState('');
  const [tpsWot,      setTpsWot]      = useState('');
  const [gdsDctStep1, setGdsDctStep1] = useState(''); // PASS/FAIL
  const [gdsDctMsg1,  setGdsDctMsg1]  = useState('');
  const [gdsDctStep2, setGdsDctStep2] = useState(''); // PASS/FAIL
  const [gdsDctMsg2,  setGdsDctMsg2]  = useState('');
  const [noiseType,   setNoiseType]   = useState('');
  const [noiseLoc,    setNoiseLoc]    = useState('');
  const [noiseSpeed,  setNoiseSpeed]  = useState('');

  // Bottom
  const [techlineCase,  setTechlineCase]  = useState('');
  const [priorAuth,     setPriorAuth]     = useState('');
  const [svcMgrSig,     setSvcMgrSig]     = useState('');
  const [techSSN,       setTechSSN]       = useState('');

  const [status,    setStatus]    = useState('');
  const [saving,    setSaving]    = useState(false);
  const [savedList, setSavedList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showUploads, setShowUploads] = useState(false);
  const [showConditionChart, setShowConditionChart] = useState(false);

  // Load saved worksheets index
  useEffect(() => {
    loadGithubFile('data/dct-worksheets/index.json')
      .then(d => setSavedList(Array.isArray(d) ? d : []))
      .catch(() => setSavedList([]))
      .finally(() => setLoadingList(false));
  }, []);

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  }

  function validate() {
    if (!ro)           { setStatus('❌ Repair Order Number is required.'); return false; }
    if (!vin || vin.length !== 17) { setStatus('❌ VIN must be exactly 17 characters.'); return false; }
    if (!specificCondition) { setStatus('❌ Specific condition/concerns is required.'); return false; }
    setStatus('');
    return true;
  }

  async function buildPdf() {
    const raw   = atob(DCT_MTM_PDF_B64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page   = pdfDoc.getPages()[0];
    const BLACK  = rgb(0,0,0);
    const h      = page.getHeight(); // 792

    function t(text, x, y, size = 9, f = font) {
      page.drawText(String(text || ''), { x, y: h - y, size, font: f, color: BLACK });
    }

    // Row 1: RO, Dealer Code, Name, Repair Date, Mileage
    t(ro,            470, 82,  9);
    t(dealerCode,    48,  112, 9);
    t(techName,      135, 112, 9);
    t(fmtDate(repairDate), 415, 112, 9);
    t(mileage,       530, 112, 9);

    // VIN (individual boxes ~18px wide starting at x=48)
    vin.split('').slice(0,17).forEach((ch, i) => t(ch, 52 + i * 18.5, 134, 9));

    // Repair Type checkboxes
    if (repairType === 'Warranty')     t('X', 418, 134, 9, boldFont);
    if (repairType === 'Customer Pay') t('X', 499, 134, 9, boldFont);

    // Part numbers
    t(removedPN,   48,  158, 9);
    t(removedSN,   330, 158, 9);
    t(installedPN, 48,  178, 9);
    t(installedSN, 330, 178, 9);

    // Condition code
    t(conditionCode, 195, 204, 9);

    // Symptom
    t(specificCondition, 195, 232, 8);
    t(howLong,           195, 248, 8);
    // How often checkboxes
    if (howOften === 'Always')       t('X', 194, 263, 9, boldFont);
    if (howOften === 'Sometimes')    t('X', 249, 263, 9, boldFont);
    if (howOften === 'Intermittent') t('X', 315, 263, 9, boldFont);
    if (whenHotCold === 'Hot')  t('X', 469, 263, 9, boldFont);
    if (whenHotCold === 'Cold') t('X', 515, 263, 9, boldFont);
    // Been in before
    if (beenInBefore === 'Yes') t('X', 182, 279, 9, boldFont);
    if (beenInBefore === 'No')  t('X', 218, 279, 9, boldFont);
    // TSB check
    if (checkedTSB === 'Yes') t('X', 435, 279, 9, boldFont);
    if (checkedTSB === 'No')  t('X', 471, 279, 9, boldFont);
    // Duplicate
    if (canDuplicate === 'Yes') t('X', 182, 295, 9, boldFont);
    if (canDuplicate === 'No')  t('X', 218, 295, 9, boldFont);
    t(howDuplicate, 285, 295, 8);
    t(testDriveResults, 195, 311, 8);

    // Fluid
    t(fluidLevel,   55,  352, 8);
    t(fluidSmell,   55,  368, 8);
    t(fluidColor,   105, 368, 8);
    t(leakLocation, 55,  395, 8);
    t(gdsCode1,     55,  435, 8);
    t(gdsCode2,     55,  447, 8);
    t(ecmLevel,     90,  490, 8);
    t(tcmLevel,     90,  503, 8);

    // Gear results
    const gearY = [348,363,378,393,408,423,438,453,468,483];
    GEARS.forEach((g, i) => {
      const res = gearResults[g];
      if (res === 'OK')     t('X', 268, gearY[i], 9, boldFont);
      if (res === 'SLIPS')  t('X', 292, gearY[i], 9, boldFont);
      if (res === 'GRINDS') t('X', 316, gearY[i], 9, boldFont);
    });

    // Driveability
    t(tpsIdle, 430, 370, 8);
    t(tpsWot,  430, 383, 8);
    // GDS relearn
    if (gdsDctStep1 === 'PASS') t('X', 430, 413, 9, boldFont);
    if (gdsDctStep1 === 'FAIL') t('X', 460, 413, 9, boldFont);
    t(gdsDctMsg1, 380, 427, 8);
    if (gdsDctStep2 === 'PASS') t('X', 430, 441, 9, boldFont);
    if (gdsDctStep2 === 'FAIL') t('X', 460, 441, 9, boldFont);
    t(gdsDctMsg2, 380, 455, 8);

    // Noise
    t(noiseType,  395, 480, 8);
    t(noiseLoc,   395, 495, 8);
    t(noiseSpeed, 395, 510, 8);

    // Bottom
    t(techlineCase, 390, 540, 8);
    t(priorAuth,    500, 540, 8);
    t(svcMgrSig,    145, 558, 8);
    t(techSSN,      195, 574, 9);

    return pdfDoc.save();
  }

  async function handlePrint() {
    if (!validate()) return;
    setStatus('⏳ Generating PDF…');
    try {
      const pdfBytes = await buildPdf();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const win  = window.open(url, '_blank');
      if (win) win.focus();
      setStatus('✅ Opened for printing.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
  }

  async function handleDownload() {
    if (!validate()) return;
    setStatus('⏳ Generating PDF…');
    try {
      const pdfBytes = await buildPdf();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `DCT_MTM_Worksheet_RO${ro || 'unknown'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('✅ Downloaded.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setStatus('⏳ Saving…');
    try {
      const id = `${ro}_${Date.now().toString(36)}`;
      const data = {
        id, ro, dealerCode, techName, repairDate, mileage, vin, repairType,
        removedPN, removedSN, installedPN, installedSN, conditionCode,
        specificCondition, howLong, howOften, whenHotCold, beenInBefore, checkedTSB,
        canDuplicate, howDuplicate, testDriveResults,
        fluidLevel, fluidSmell, fluidColor, leakLocation, gdsCode1, gdsCode2,
        ecmLevel, tcmLevel, gearResults, tpsIdle, tpsWot,
        gdsDctStep1, gdsDctMsg1, gdsDctStep2, gdsDctMsg2,
        noiseType, noiseLoc, noiseSpeed,
        techlineCase, priorAuth, svcMgrSig, techSSN,
        savedBy: currentUser, savedAt: new Date().toISOString(),
      };
      await saveGithubFile(`data/dct-worksheets/${id}.json`, data);
      const newIndex = [{ id, ro, vin, techName, repairDate, savedAt: data.savedAt }, ...savedList];
      await saveGithubFile('data/dct-worksheets/index.json', newIndex);
      setSavedList(newIndex);
      setStatus('✅ Saved! Other users can now open this worksheet.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSaving(false); }
  }

  async function loadSaved(item) {
    setStatus('⏳ Loading…');
    try {
      const d = await loadGithubFile(`data/dct-worksheets/${item.id}.json`);
      setRo(d.ro || ''); setDealerCode(d.dealerCode || DEALER_CODE); setTechName(d.techName || '');
      setRepairDate(d.repairDate || today); setMileage(d.mileage || ''); setVin(d.vin || '');
      setRepairType(d.repairType || ''); setRemovedPN(d.removedPN || ''); setRemovedSN(d.removedSN || '');
      setInstalledPN(d.installedPN || ''); setInstalledSN(d.installedSN || '');
      setConditionCode(d.conditionCode || ''); setSpecificCondition(d.specificCondition || '');
      setHowLong(d.howLong || ''); setHowOften(d.howOften || ''); setWhenHotCold(d.whenHotCold || '');
      setBeenInBefore(d.beenInBefore || ''); setCheckedTSB(d.checkedTSB || '');
      setCanDuplicate(d.canDuplicate || ''); setHowDuplicate(d.howDuplicate || '');
      setTestDriveResults(d.testDriveResults || ''); setFluidLevel(d.fluidLevel || '');
      setFluidSmell(d.fluidSmell || ''); setFluidColor(d.fluidColor || '');
      setLeakLocation(d.leakLocation || ''); setGdsCode1(d.gdsCode1 || ''); setGdsCode2(d.gdsCode2 || '');
      setEcmLevel(d.ecmLevel || ''); setTcmLevel(d.tcmLevel || '');
      setGearResults(d.gearResults || Object.fromEntries(GEARS.map(g => [g, ''])));
      setTpsIdle(d.tpsIdle || ''); setTpsWot(d.tpsWot || '');
      setGdsDctStep1(d.gdsDctStep1 || ''); setGdsDctMsg1(d.gdsDctMsg1 || '');
      setGdsDctStep2(d.gdsDctStep2 || ''); setGdsDctMsg2(d.gdsDctMsg2 || '');
      setNoiseType(d.noiseType || ''); setNoiseLoc(d.noiseLoc || ''); setNoiseSpeed(d.noiseSpeed || '');
      setTechlineCase(d.techlineCase || ''); setPriorAuth(d.priorAuth || '');
      setSvcMgrSig(d.svcMgrSig || ''); setTechSSN(d.techSSN || '');
      setStatus('✅ Worksheet loaded.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div className="adv-topbar">
        <div>
          <div className="adv-title">⚙️ DCT & MTM Diagnosis Worksheet</div>
          <div className="adv-sub">Remanufactured DCT & MTM — SVC-1401</div>
        </div>
        <button className="secondary" onClick={onBack}>← AT Diag Worksheet</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', display: 'flex', gap: 24 }}>
        {/* Main form */}
        <div style={{ flex: 1, minWidth: 0 }}>


          {/* Basic Info */}
          <div style={section}>
            <div style={sectionTitle}>📋 Basic Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
              <Field label="Repair Order Number *" value={ro} onChange={setRo} placeholder="RO#" />
              <Field label="Dealer Code *" value={dealerCode} onChange={setDealerCode} />
              <Field label="Technician Name *" value={techName} onChange={setTechName} />
              <Field label="Repair Date *" value={repairDate} onChange={setRepairDate} type="date" />
              <Field label="Mileage *" value={mileage} onChange={setMileage} placeholder="e.g. 45000" />
            </div>
            <div style={{ marginTop: 14 }}>
              <Field label="VIN * (17 characters)" value={vin} onChange={v => setVin(v.toUpperCase().slice(0,17))} placeholder="17-character VIN" />
              <div style={{ fontSize: 11, color: vin.length === 17 ? '#4ade80' : '#64748b', marginTop: 3 }}>{vin.length}/17 characters</div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={lbl}>Repair Type *</label>
              <div style={{ display: 'flex', gap: 16 }}>
                {['Warranty', 'Customer Pay'].map(opt => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: repairType === opt ? '#6ee7b7' : '#64748b', fontWeight: repairType === opt ? 700 : 400, fontSize: 14 }}>
                    <input type="radio" name="repairType" checked={repairType === opt} onChange={() => setRepairType(opt)} style={{ accentColor: '#6ee7b7' }} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              <Field label="Removed Part Number *" value={removedPN} onChange={setRemovedPN} placeholder="XXX-XXX-XXXXX" />
              <Field label="Removed Serial Number *" value={removedSN} onChange={setRemovedSN} />
              <Field label="Installed Part Number *" value={installedPN} onChange={setInstalledPN} placeholder="XXX-XXX-XXXXX" />
              <Field label="Installed Serial Number *" value={installedSN} onChange={setInstalledSN} />
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={lbl}>Condition Code *</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  value={conditionCode}
                  onChange={e => setConditionCode(e.target.value)}
                  placeholder="Click 'Condition Chart' to select a code"
                  style={{ ...inp, flex: 1 }}
                />
                <button
                  onClick={() => setShowConditionChart(true)}
                  style={{ whiteSpace: 'nowrap', background: 'linear-gradient(135deg,rgba(251,191,36,.25),rgba(245,158,11,.18))', border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                >
                  📋 Condition Chart
                </button>
              </div>
            </div>
          </div>

          {/* Symptom */}
          <div style={section}>
            <div style={sectionTitle}>🔍 Symptom</div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>What is the specific condition/concerns? *</label>
              <textarea value={specificCondition} onChange={e => setSpecificCondition(e.target.value)} rows={2}
                style={{ ...inp, resize: 'vertical' }} placeholder="Describe the condition…" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>How long has it been occurring? *</label>
              <input style={inp} value={howLong} onChange={e => setHowLong(e.target.value)} placeholder="e.g. 2 weeks" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>How often does it occur? *</label>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {['Always','Sometimes','Intermittent'].map(opt => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: howOften === opt ? '#6ee7b7' : '#64748b', fontWeight: howOften === opt ? 700 : 400, fontSize: 14 }}>
                    <input type="radio" name="howOften" checked={howOften === opt} onChange={() => setHowOften(opt)} style={{ accentColor: '#6ee7b7' }} />
                    {opt}
                  </label>
                ))}
                <span style={{ color: '#64748b', fontSize: 13, marginLeft: 8 }}>When:</span>
                {['Hot','Cold'].map(opt => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: whenHotCold === opt ? '#6ee7b7' : '#64748b', fontWeight: whenHotCold === opt ? 700 : 400, fontSize: 14 }}>
                    <input type="radio" name="whenHotCold" checked={whenHotCold === opt} onChange={() => setWhenHotCold(opt)} style={{ accentColor: '#6ee7b7' }} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Has the car been in for this condition before? *</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  {['Yes','No'].map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: beenInBefore === opt ? '#6ee7b7' : '#64748b', fontWeight: beenInBefore === opt ? 700 : 400, fontSize: 14 }}>
                      <input type="radio" name="beenIn" checked={beenInBefore === opt} onChange={() => setBeenInBefore(opt)} style={{ accentColor: '#6ee7b7' }} />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={lbl}>Did you check for applicable TSB's? *</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  {['Yes','No'].map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: checkedTSB === opt ? '#6ee7b7' : '#64748b', fontWeight: checkedTSB === opt ? 700 : 400, fontSize: 14 }}>
                      <input type="radio" name="tsb" checked={checkedTSB === opt} onChange={() => setCheckedTSB(opt)} style={{ accentColor: '#6ee7b7' }} />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Can you duplicate the condition? *</label>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                {['Yes','No'].map(opt => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: canDuplicate === opt ? '#6ee7b7' : '#64748b', fontWeight: canDuplicate === opt ? 700 : 400, fontSize: 14 }}>
                    <input type="radio" name="dup" checked={canDuplicate === opt} onChange={() => setCanDuplicate(opt)} style={{ accentColor: '#6ee7b7' }} />
                    {opt}
                  </label>
                ))}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <input style={inp} value={howDuplicate} onChange={e => setHowDuplicate(e.target.value)} placeholder="How?" />
                </div>
              </div>
            </div>
            <div>
              <label style={lbl}>Test Drive Results *</label>
              <input style={inp} value={testDriveResults} onChange={e => setTestDriveResults(e.target.value)} placeholder="Describe test drive results…" />
            </div>
          </div>

          {/* Fluid / GDS / ECM */}
          <div style={section}>
            <div style={sectionTitle}>🛢 Fluid Check & Software</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
              <Field label="Fluid Level *" value={fluidLevel} onChange={setFluidLevel} placeholder="e.g. Normal" />
              <Field label="Fluid Smell *" value={fluidSmell} onChange={setFluidSmell} placeholder="e.g. Normal" />
              <Field label="Fluid Color *" value={fluidColor} onChange={setFluidColor} placeholder="e.g. Red/Clear" />
            </div>
            <div style={{ marginTop: 14 }}>
              <Field label="Leaks: Location *" value={leakLocation} onChange={setLeakLocation} placeholder="e.g. None / Front seal" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              <Field label="GDS Code 1 * (Engine & Trans Menu)" value={gdsCode1} onChange={setGdsCode1} placeholder="e.g. P0740" />
              <Field label="GDS Code 2" value={gdsCode2} onChange={setGdsCode2} placeholder="e.g. P0741" />
              <Field label="ECM Software Level *" value={ecmLevel} onChange={setEcmLevel} placeholder="ECM version" />
              <Field label="TCM Software Level *" value={tcmLevel} onChange={setTcmLevel} placeholder="TCM version" />
            </div>
          </div>

          {/* Test Drive Results per gear */}
          <div style={section}>
            <div style={sectionTitle}>🏎 Test Drive Result — Per Gear</div>
            {/* Header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '160px 80px 80px 90px', gap: '0 8px', marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              <span style={{ ...lbl, marginBottom: 0 }}>Gear</span>
              <span style={{ ...lbl, marginBottom: 0, textAlign: 'center' }}>OK</span>
              <span style={{ ...lbl, marginBottom: 0, textAlign: 'center' }}>SLIPS</span>
              <span style={{ ...lbl, marginBottom: 0, textAlign: 'center' }}>GRINDS</span>
            </div>
            {GEARS.map((g, i) => (
              <div key={g} style={{ display: 'grid', gridTemplateColumns: '160px 80px 80px 90px', gap: '0 8px', alignItems: 'center', padding: '6px 0', borderBottom: i < GEARS.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', background: i % 2 === 0 ? 'rgba(255,255,255,.02)' : 'transparent', borderRadius: 4 }}>
                <span style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600, paddingLeft: 6 }}>{g}</span>
                {['OK','SLIPS','GRINDS'].map(opt => (
                  <div key={opt} style={{ display: 'flex', justifyContent: 'center' }}>
                    <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <input type="radio" name={`gear-${g}`} value={opt} checked={gearResults[g] === opt}
                        onChange={() => setGearResults(prev => ({ ...prev, [g]: opt }))}
                        style={{ accentColor: opt === 'OK' ? '#4ade80' : opt === 'SLIPS' ? '#fbbf24' : '#f87171', width: 16, height: 16, cursor: 'pointer' }} />
                    </label>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Driveability */}
          <div style={section}>
            <div style={sectionTitle}>📊 Driveability Data (Engine Off — Trans Menu)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
              <Field label="TPS Idle (% / V)" value={tpsIdle} onChange={setTpsIdle} placeholder="e.g. 0.5" />
              <Field label="TPS WOT (% / V)" value={tpsWot} onChange={setTpsWot} placeholder="e.g. 4.8" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              {/* Step 1 */}
              <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ ...lbl, marginBottom: 10 }}>GDS DCT Relearn — Step 1</div>
                <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
                  {['PASS','FAIL'].map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="radio" name="step1" checked={gdsDctStep1 === opt} onChange={() => setGdsDctStep1(opt)}
                        style={{ accentColor: opt === 'PASS' ? '#4ade80' : '#f87171', width: 16, height: 16, cursor: 'pointer' }} />
                      <span style={{ color: gdsDctStep1 === opt ? (opt === 'PASS' ? '#4ade80' : '#f87171') : '#64748b', fontWeight: gdsDctStep1 === opt ? 800 : 400, fontSize: 14 }}>{opt}</span>
                    </label>
                  ))}
                </div>
                <input style={inp} value={gdsDctMsg1} onChange={e => setGdsDctMsg1(e.target.value)} placeholder="Failure message (if any)" />
              </div>
              {/* Step 2 */}
              <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ ...lbl, marginBottom: 10 }}>GDS DCT Relearn — Step 2</div>
                <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
                  {['PASS','FAIL'].map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="radio" name="step2" checked={gdsDctStep2 === opt} onChange={() => setGdsDctStep2(opt)}
                        style={{ accentColor: opt === 'PASS' ? '#4ade80' : '#f87171', width: 16, height: 16, cursor: 'pointer' }} />
                      <span style={{ color: gdsDctStep2 === opt ? (opt === 'PASS' ? '#4ade80' : '#f87171') : '#64748b', fontWeight: gdsDctStep2 === opt ? 800 : 400, fontSize: 14 }}>{opt}</span>
                    </label>
                  ))}
                </div>
                <input style={inp} value={gdsDctMsg2} onChange={e => setGdsDctMsg2(e.target.value)} placeholder="Failure message (if any)" />
              </div>
            </div>

            <div style={{ ...lbl, marginBottom: 10 }}>Noise</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              <Field label="Type" value={noiseType} onChange={setNoiseType} placeholder="e.g. Grinding" />
              <Field label="Location" value={noiseLoc} onChange={setNoiseLoc} placeholder="e.g. Front of trans" />
              <Field label="Speed & Gear" value={noiseSpeed} onChange={setNoiseSpeed} placeholder="e.g. 30mph 3rd gear" />
            </div>
          </div>

          {/* Bottom */}
          <div style={section}>
            <div style={sectionTitle}>✍️ Authorization & Signature</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
              <Field label="Techline Case # *" value={techlineCase} onChange={setTechlineCase} />
              <Field label="Prior Authorization # *" value={priorAuth} onChange={setPriorAuth} />
              <Field label="Service Manager Signature" value={svcMgrSig} onChange={setSvcMgrSig} />
              <Field label="Tech SSN (last 4 digits ONLY) *" value={techSSN} onChange={v => setTechSSN(v.replace(/\D/g,'').slice(0,4))} placeholder="XXXX" />
            </div>
          </div>

          {/* Status */}
          {status && (
            <div style={{ marginBottom: 16, padding: '10px 16px', background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : status.startsWith('❌') ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.05)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : status.startsWith('❌') ? 'rgba(239,68,68,.3)' : 'rgba(255,255,255,.1)'}`, borderRadius: 8, color: status.startsWith('✅') ? '#4ade80' : status.startsWith('❌') ? '#f87171' : '#94a3b8', fontSize: 13, fontWeight: 700 }}>
              {status}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <button onClick={handlePrint}
              style={{ background: 'rgba(139,92,246,.2)', border: '1px solid rgba(139,92,246,.5)', color: '#c4b5fd', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
              🖨️ Print
            </button>
            <button onClick={handleDownload}
              style={{ background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.5)', color: '#6ee7f9', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
              ⬇️ Download PDF
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ background: 'rgba(251,191,36,.2)', border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14, opacity: saving ? 0.6 : 1 }}>
              💾 Upload
            </button>
            <button onClick={() => setShowUploads(v => !v)}
              style={{ background: showUploads ? 'rgba(139,92,246,.25)' : 'rgba(255,255,255,.06)', border: `1px solid ${showUploads ? 'rgba(139,92,246,.5)' : 'rgba(255,255,255,.15)'}`, color: showUploads ? '#c4b5fd' : '#94a3b8', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
              📂 View Uploads {savedList.length > 0 ? `(${savedList.length})` : ''}
            </button>
          </div>
          {/* Uploads panel */}
          {showUploads && (
            <div style={{ ...section, marginBottom: 20 }}>
              <div style={sectionTitle}>📂 Uploaded Worksheets</div>
              {loadingList ? (
                <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div>
              ) : savedList.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No uploaded worksheets yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {savedList.map(s => (
                    <button key={s.id} onClick={() => { loadSaved(s); setShowUploads(false); }}
                      style={{ background: 'rgba(139,92,246,.08)', border: '1px solid rgba(139,92,246,.25)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', transition: 'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(139,92,246,.18)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(139,92,246,.08)'}
                    >
                      <span style={{ fontWeight: 900, fontSize: 14, color: '#c4b5fd' }}>RO# {s.ro || '—'}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>VIN: {s.vin || '—'}</span>
                      <span style={{ fontSize: 12, color: '#64748b' }}>Tech: {s.techName || '—'}</span>
                      <span style={{ fontSize: 12, color: '#64748b' }}>Date: {s.repairDate || '—'}</span>
                      <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>
                        Uploaded {s.savedAt ? new Date(s.savedAt).toLocaleDateString() : '—'}
                      </span>
                      <span style={{ fontSize: 11, color: '#6ee7b7', fontWeight: 700 }}>Click to Load →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!getGithubToken() && (
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, padding: '8px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)' }}>
              ℹ️ <strong style={{ color: '#94a3b8' }}>Print & Download work for everyone.</strong> To save worksheets to GitHub for other users to access, a manager must first set the GitHub token in Admin Settings on this device.
            </div>
          )}
        </div>
      </div>

      {/* Condition Code Chart Modal */}
      {showConditionChart && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowConditionChart(false)}>
          <div style={{ background: '#1e293b', border: '1px solid rgba(251,191,36,.4)', borderRadius: 18, width: '100%', maxWidth: 900, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,.08)', background: 'rgba(251,191,36,.08)', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#fbbf24', letterSpacing: 1 }}>📋 DCT/MTM CONDITION CODES</div>
                <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>Click any condition to auto-fill the code</div>
              </div>
              <button onClick={() => setShowConditionChart(false)}
                style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', color: '#94a3b8', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                ✕ Close
              </button>
            </div>
            {/* Scrollable code list — two columns */}
            <div style={{ overflowY: 'auto', padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px', alignItems: 'start' }}>
              {CONDITION_CODES.map(group => (
                <div key={group.group} style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 900, fontSize: 11, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid rgba(251,191,36,.2)' }}>
                    {group.group}
                  </div>
                  {group.codes.map(item => (
                    <button
                      key={`${item.code}-${item.desc}`}
                      onClick={() => { setConditionCode(item.code); setShowConditionChart(false); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', textAlign: 'left', marginBottom: 2, transition: 'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,.12)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ minWidth: 38, fontWeight: 900, fontSize: 14, color: '#fbbf24', fontFamily: 'monospace' }}>{item.code}</span>
                      <span style={{ fontSize: 13, color: '#cbd5e1' }}>{item.desc}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
