import React, { useState, useEffect } from 'react';
import { PDFDocument, PDFName } from 'pdf-lib';
import { ATM_PDF_B64 } from '../assets/atmPdfBase64';
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

const GEARS = ['1st Gear','2nd Gear','3rd Gear','4th Gear','5th Gear','6th Gear','7th Gear','8th Gear'];

const ATM_CONDITION_CODES = [
  { group: 'SLIPS', codes: [
    { code: '100', desc: 'Slips in Reverse' },
    { code: '101', desc: 'Slips in Drive' },
    { code: '102', desc: 'Slips in 1st gear' },
    { code: '103', desc: 'Slips in 2nd gear' },
    { code: '104', desc: 'Slips in 3rd gear' },
    { code: '105', desc: 'Slips in 4th gear' },
    { code: '106', desc: 'Slips in 5th gear' },
    { code: '107', desc: 'Slips other gear (specify)' },
  ]},
  { group: 'SLIPS/FLARES BETWEEN GEARS', codes: [
    { code: '110', desc: 'Slips/flares 1-2 shift' },
    { code: '111', desc: 'Slips/flares 2-3 shift' },
    { code: '112', desc: 'Slips/flares 3-4 shift' },
    { code: '113', desc: 'Slips/flares 4-5 shift' },
    { code: '114', desc: 'Slips/flares 5-4 downshift' },
    { code: '115', desc: 'Slips/flares 4-3 downshift' },
    { code: '116', desc: 'Slips/flares 3-2 downshift' },
    { code: '117', desc: 'Slips/flares 2-1 downshift' },
    { code: '118', desc: 'Slips/flares other gear (specify)' },
  ]},
  { group: 'SHIFT SHUDDER', codes: [
    { code: '120', desc: 'Shudder into Drive' },
    { code: '121', desc: 'Shudder into Reverse' },
    { code: '122', desc: 'Shudder 1-2 shift' },
    { code: '123', desc: 'Shudder 2-3 shift' },
    { code: '124', desc: 'Shudder 3-4 shift' },
    { code: '125', desc: 'Shudder 4-5 shift' },
    { code: '126', desc: 'Shudder during acceleration from stop' },
    { code: '127', desc: 'Shudder - Other (Specify)' },
  ]},
  { group: 'SHIFTS ERRATIC / UP OR DOWN TOO OFTEN', codes: [
    { code: '130', desc: 'Erratic upshift (specify)' },
    { code: '131', desc: 'Erratic downshift (specify)' },
    { code: '132', desc: 'Erratic shift - other (specify)' },
  ]},
  { group: 'CHECK ENGINE LIGHT ON', codes: [
    { code: '140', desc: 'Check engine light on — "Engine" menu (specify DTC)' },
    { code: '141', desc: 'Check engine light on — "Trans" menu (specify DTC)' },
  ]},
  { group: 'LEAKS', codes: [
    { code: '150', desc: 'Leaks at oil pump/bellhousing' },
    { code: '151', desc: 'Leaks at case (specify location)' },
    { code: '152', desc: 'Leaks at differential oil seal (specify left or right)' },
    { code: '153', desc: 'Leaks between transaxle and transfer case' },
    { code: '154', desc: 'Leaks between case halves' },
    { code: '155', desc: 'Leaks at rear cover' },
    { code: '156', desc: 'Oil leak due to crack in case (specify location)' },
    { code: '157', desc: 'Other leak (specify)' },
  ]},
  { group: 'CASE BROKEN / CRACKED', codes: [
    { code: '160', desc: 'Converter case broken/cracked (specify location)' },
    { code: '161', desc: 'Transaxle case broken/cracked (specify location)' },
  ]},
  { group: 'WILL NOT MOVE', codes: [
    { code: '170', desc: 'Will not move in Reverse' },
    { code: '171', desc: 'Will not move in Drive / No forward gears' },
  ]},
  { group: 'SHIFTS HARSH or ROUGH / BANGS / JERKS', codes: [
    { code: '180', desc: 'Harsh shift in Drive' },
    { code: '181', desc: 'Harsh shift into Reverse' },
    { code: '182', desc: 'Harsh 1-2 shift' },
    { code: '183', desc: 'Harsh 2-3 shift' },
    { code: '184', desc: 'Harsh 3-4 shift' },
    { code: '185', desc: 'Harsh 4-5 shift' },
    { code: '186', desc: 'Harsh downshift 5-4' },
    { code: '187', desc: 'Harsh downshift 4-3' },
    { code: '188', desc: 'Harsh downshift 3-2' },
    { code: '189', desc: 'Harsh downshift 2-1' },
  ]},
  { group: 'DELAYED SHIFT', codes: [
    { code: '190', desc: 'Delayed shift into Drive' },
    { code: '191', desc: 'Delayed shift into Reverse' },
    { code: '192', desc: 'Delayed 1-2 shift' },
    { code: '193', desc: 'Delayed 2-3 shift' },
    { code: '194', desc: 'Delayed 3-4 shift' },
    { code: '195', desc: 'Delayed 4-5 shift' },
    { code: '196', desc: 'Delayed 5-4 shift' },
    { code: '197', desc: 'Delayed 4-3 shift' },
    { code: '198', desc: 'Delayed 3-2 shift' },
    { code: '199', desc: 'Delayed 2-1 shift' },
  ]},
  { group: "WON'T SHIFT / STUCK IN GEAR", codes: [
    { code: '200', desc: "Won't shift in Drive" },
    { code: '201', desc: 'Stuck in 1st gear' },
    { code: '202', desc: 'Stuck in 2nd gear (specify DTC)' },
    { code: '203', desc: 'Stuck in 3rd gear (specify DTC)' },
    { code: '204', desc: 'Stuck in 4th gear (specify DTC)' },
    { code: '205', desc: "Won't shift - other (specify)" },
  ]},
  { group: 'NOISE', codes: [
    { code: '220', desc: 'Noise in 1st gear' },
    { code: '221', desc: 'Noise in 2nd gear' },
    { code: '222', desc: 'Noise in 3rd gear' },
    { code: '223', desc: 'Noise in 4th gear' },
    { code: '224', desc: 'Noise in 5th gear' },
    { code: '225', desc: 'Noise in reverse' },
    { code: '226', desc: 'Noise during acceleration/deceleration' },
    { code: '227', desc: 'Whine noise (specify road speed)' },
    { code: '228', desc: 'Noise from differential (specify road speed)' },
    { code: '229', desc: 'Noise - other (specify)' },
  ]},
];

export default function ATMWorksheet({ onBack, currentUser, currentRole }) {
  const today = new Date().toISOString().slice(0, 10);

  const [ro,            setRo]            = useState('');
  const [dealerCode,    setDealerCode]    = useState(DEALER_CODE);
  const [techName,      setTechName]      = useState(currentUser || '');
  const [repairDate,    setRepairDate]    = useState(today);
  const [mileage,       setMileage]       = useState('');
  const [vin,           setVin]           = useState('');
  const [repairType,    setRepairType]    = useState('');
  const [removedPN,     setRemovedPN]     = useState('');
  const [removedSN,     setRemovedSN]     = useState('');
  const [installedPN,   setInstalledPN]   = useState('');
  const [installedSN,   setInstalledSN]   = useState('');
  const [conditionCode, setConditionCode] = useState('');

  // Symptom
  const [specificCondition, setSpecificCondition] = useState('');
  const [howLong,           setHowLong]           = useState('');
  const [howOften,          setHowOften]          = useState('');
  const [whenHotCold,       setWhenHotCold]        = useState('');
  const [beenInBefore,      setBeenInBefore]       = useState('');
  const [checkedTSB,        setCheckedTSB]         = useState('');
  const [howDuplicate,      setHowDuplicate]       = useState('');
  const [testDriveResults,  setTestDriveResults]   = useState('');

  // Fluid
  const [fluidLevel,   setFluidLevel]   = useState('');
  const [fluidSmell,   setFluidSmell]   = useState('');
  const [fluidColor,   setFluidColor]   = useState('');
  const [leakLocation, setLeakLocation] = useState('');
  const [atfCold,      setAtfCold]      = useState('');
  const [atfHot,       setAtfHot]       = useState('');
  const [gdsCode1,     setGdsCode1]     = useState('');
  const [gdsCode2,     setGdsCode2]     = useState('');

  // Gear selector
  const [gearD, setGearD] = useState('');
  const [gearL, setGearL] = useState('');
  const [gearR, setGearR] = useState('');

  // TPS
  const [tpsIdle, setTpsIdle] = useState('');
  const [tpsWot,  setTpsWot]  = useState('');

  // Gear test results — OK or SLIPS only
  const [gearResults, setGearResults] = useState(() => Object.fromEntries(GEARS.map(g => [g, ''])));

  // TCC
  const [tcc1, setTcc1] = useState(''); // 'OK' | 'SLIPS' | ''
  const [tcc2, setTcc2] = useState('');

  // Hybrid checks
  const [electricOk,      setElectricOk]      = useState(''); // 'Yes'|'No'
  const [movementElectric,setMovementElectric] = useState(''); // 'Yes'|'No'
  const [movementGas,     setMovementGas]      = useState(''); // 'Yes'|'No'

  // Authorization
  const [techlineCase, setTechlineCase] = useState('');
  const [priorAuth,    setPriorAuth]    = useState('');
  const [techSSN,      setTechSSN]      = useState('');

  const [status,      setStatus]      = useState('');
  const [saving,      setSaving]      = useState(false);
  const [savedList,   setSavedList]   = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showUploads, setShowUploads] = useState(false);
  const [showConditionChart, setShowConditionChart] = useState(false);
  const [deletingId,  setDeletingId]  = useState(null);
  const [pdfLoading,  setPdfLoading]  = useState(null);

  function refreshIndex() {
    setLoadingList(true);
    loadGithubFile('data/atm-worksheets/index.json')
      .then(d => setSavedList(Array.isArray(d) ? d : []))
      .catch(() => setSavedList([]))
      .finally(() => setLoadingList(false));
  }
  useEffect(() => { refreshIndex(); }, []);

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  }

  function splitPN(pn) {
    const clean = (pn || '').replace(/-/g, '');
    return [clean.slice(0, 5), clean.slice(5, 10), clean.slice(10, 12)];
  }

  function validate() {
    if (!ro) { setStatus('❌ Repair Order Number is required.'); return false; }
    if (!vin || vin.length !== 17) { setStatus('❌ VIN must be exactly 17 characters.'); return false; }
    if (!specificCondition) { setStatus('❌ Specific condition/concerns is required.'); return false; }
    setStatus('');
    return true;
  }

  async function buildPdf(d) {
    const _ro             = d?.ro             ?? ro;
    const _dealerCode     = d?.dealerCode     ?? dealerCode;
    const _techName       = d?.techName       ?? techName;
    const _repairDate     = d?.repairDate     ?? repairDate;
    const _mileage        = d?.mileage        ?? mileage;
    const _vin            = d?.vin            ?? vin;
    const _repairType     = d?.repairType     ?? repairType;
    const _removedPN      = d?.removedPN      ?? removedPN;
    const _removedSN      = d?.removedSN      ?? removedSN;
    const _installedPN    = d?.installedPN    ?? installedPN;
    const _installedSN    = d?.installedSN    ?? installedSN;
    const _conditionCode  = d?.conditionCode  ?? conditionCode;
    const _specificCondition = d?.specificCondition ?? specificCondition;
    const _howLong        = d?.howLong        ?? howLong;
    const _howOften       = d?.howOften       ?? howOften;
    const _whenHotCold    = d?.whenHotCold    ?? whenHotCold;
    const _beenInBefore   = d?.beenInBefore   ?? beenInBefore;
    const _checkedTSB     = d?.checkedTSB     ?? checkedTSB;
    const _howDuplicate   = d?.howDuplicate   ?? howDuplicate;
    const _testDriveResults = d?.testDriveResults ?? testDriveResults;
    const _fluidLevel     = d?.fluidLevel     ?? fluidLevel;
    const _fluidSmell     = d?.fluidSmell     ?? fluidSmell;
    const _fluidColor     = d?.fluidColor     ?? fluidColor;
    const _leakLocation   = d?.leakLocation   ?? leakLocation;
    const _atfCold        = d?.atfCold        ?? atfCold;
    const _atfHot         = d?.atfHot         ?? atfHot;
    const _gdsCode1       = d?.gdsCode1       ?? gdsCode1;
    const _gdsCode2       = d?.gdsCode2       ?? gdsCode2;
    const _gearD          = d?.gearD          ?? gearD;
    const _gearL          = d?.gearL          ?? gearL;
    const _gearR          = d?.gearR          ?? gearR;
    const _tpsIdle        = d?.tpsIdle        ?? tpsIdle;
    const _tpsWot         = d?.tpsWot         ?? tpsWot;
    const _gearResults    = d?.gearResults    ?? gearResults;
    const _tcc1           = d?.tcc1           ?? tcc1;
    const _tcc2           = d?.tcc2           ?? tcc2;
    const _electricOk     = d?.electricOk     ?? electricOk;
    const _movementElectric = d?.movementElectric ?? movementElectric;
    const _movementGas    = d?.movementGas    ?? movementGas;
    const _techlineCase   = d?.techlineCase   ?? techlineCase;
    const _priorAuth      = d?.priorAuth      ?? priorAuth;
    const _techSSN        = d?.techSSN        ?? techSSN;

    const raw   = atob(ATM_PDF_B64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const pdfDoc = await PDFDocument.load(bytes);
    const form   = pdfDoc.getForm();

    const setTxt = (name, value) => {
      if (!value && value !== 0) return;
      try { form.getTextField(name).setText(String(value)); } catch {}
    };

    const chk = (name, condition) => {
      try {
        const field = form.getField(name);
        const acroField = field.acroField;
        let onState = 'Yes';
        try {
          const ap = acroField.dict.lookup(PDFName.of('AP'));
          if (ap) {
            const n = ap.lookup(PDFName.of('N'));
            if (n && n.dict) {
              const keys = Array.from(n.dict.keys());
              const nonOff = keys.find(k => k.encodedName !== '/Off');
              if (nonOff) onState = nonOff.encodedName.replace(/^\//, '');
            }
          }
        } catch {}
        if (condition) {
          acroField.dict.set(PDFName.of('V'),  PDFName.of(onState));
          acroField.dict.set(PDFName.of('AS'), PDFName.of(onState));
        } else {
          acroField.dict.set(PDFName.of('V'),  PDFName.of('Off'));
          acroField.dict.set(PDFName.of('AS'), PDFName.of('Off'));
        }
      } catch {}
    };

    // ── Basic Info ──
    setTxt('Repair Order Number', _ro);
    setTxt('Dealer Code',         _dealerCode);
    setTxt('NameF',               _techName);
    const dateParts = fmtDate(_repairDate).split('/');
    setTxt('RO Date',     dateParts[0] || '');
    setTxt('undefined',   dateParts[1] || '');
    setTxt('undefined_2', (dateParts[2] || '').slice(-2));
    setTxt('Mileage',     _mileage);
    setTxt('VIN',         _vin);
    chk('Warranty',     _repairType === 'Warranty');
    chk('Customer Pay', _repairType === 'Customer Pay');

    // ── Part Numbers ──
    const [rpn1, rpn2, rpn3] = splitPN(_removedPN);
    setTxt('Removed Part Number', rpn1);
    setTxt('undefined_3',         rpn2);
    setTxt('undefined_4',         rpn3);
    setTxt('Removed Serial Number', _removedSN);
    const [ipn1, ipn2, ipn3] = splitPN(_installedPN);
    setTxt('Installed Part Number', ipn1);
    setTxt('undefined_5',           ipn2);
    setTxt('undefined_6',           ipn3);
    setTxt('Installed Serial Number', _installedSN);

    // ── Condition Code ──
    setTxt('What is the specific condition code', _conditionCode);

    // ── Symptom ──
    setTxt('What is the specific conditionconcerns', _specificCondition);
    setTxt('How long has it been occurring',         _howLong);
    chk('Hot',  _whenHotCold === 'Hot');
    chk('Cold', _whenHotCold === 'Cold');
    chk('Yes1', _beenInBefore === 'Yes');
    chk('Not',  _beenInBefore === 'No');
    chk('Yes2', _checkedTSB === 'Yes');
    chk('No2',  _checkedTSB === 'No');
    setTxt('If yes how',        _howDuplicate);
    setTxt('Test Drive Results', _testDriveResults);

    // ── Fluid ──
    setTxt('Level',          _fluidLevel);
    setTxt('Smell',          _fluidSmell);
    setTxt('Color',          _fluidColor);
    setTxt('LEAKS LOCATION', _leakLocation);
    setTxt('ATF Cold',       _atfCold);
    setTxt('ATF Hot',        _atfHot);
    setTxt('From Engine  AT Menu 1', _gdsCode1);
    setTxt('From Engine  AT Menu 2', _gdsCode2);

    // ── Gear Selector ──
    setTxt('D', _gearD);
    setTxt('L', _gearL);
    setTxt('R', _gearR);

    // ── TPS ──
    setTxt('TPS idle', _tpsIdle);
    setTxt('TPS WOT',  _tpsWot);

    // ── Gear Results (OK / SLIPS only) ──
    const gearFieldMap = [
      ['Gear ok1','Gear Slips1'],
      ['Gear ok2','Gear Slips2'],
      ['Gear ok3','Gear Slips3'],
      ['Gear ok4','Gear Slips4'],
      ['Gear ok5','Gear Slips5'],
      ['Gear ok6','Gear Slips6'],
      ['Gear ok7','Gear Slips7'],
      ['Gear ok8','Gear Slips8'],
    ];
    GEARS.forEach((g, i) => {
      const res = (_gearResults || {})[g];
      chk(gearFieldMap[i][0], res === 'OK');
      chk(gearFieldMap[i][1], res === 'SLIPS');
    });
    chk('TCC 1', _tcc1 === 'OK');
    chk('TCC2',  _tcc2 === 'OK');

    // ── Hybrid / Electric ──
    chk('Electric Yes',        _electricOk === 'Yes');
    chk('Electric N0',         _electricOk === 'No');
    chk('Movement Electric Yes', _movementElectric === 'Yes');
    chk('Movement Electric No',  _movementElectric === 'No');
    chk('Movement Gas Yes',    _movementGas === 'Yes');
    chk('Movement Gas No',     _movementGas === 'No');

    // ── Authorization ──
    setTxt('Techline Case',              _techlineCase);
    setTxt('Prior Authorization',        _priorAuth);
    setTxt('Technician SSN last 4 digits', _techSSN);

    return pdfDoc.save();
  }

  async function openPdf(data, roNum) {
    const pdfBytes = await buildPdf(data);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (win) win.focus();
  }

  async function downloadPdf(data, roNum) {
    const pdfBytes = await buildPdf(data);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `ATM_Worksheet_RO${roNum || 'unknown'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleViewSaved(item) {
    setPdfLoading(item.id + '_view');
    try {
      const d = await loadGithubFile(`data/atm-worksheets/${item.id}.json`);
      if (!d) { alert('Could not load worksheet.'); return; }
      await openPdf(d, d.ro);
    } catch(e) { alert(`Error: ${e.message}`); }
    finally { setPdfLoading(null); }
  }

  async function handleDownloadSaved(item) {
    setPdfLoading(item.id + '_dl');
    try {
      const d = await loadGithubFile(`data/atm-worksheets/${item.id}.json`);
      if (!d) { alert('Could not load worksheet.'); return; }
      await downloadPdf(d, d.ro);
    } catch(e) { alert(`Error: ${e.message}`); }
    finally { setPdfLoading(null); }
  }

  async function handleDeleteSaved(item) {
    if (!window.confirm(`Delete worksheet RO# ${item.ro || item.id}? This cannot be undone.`)) return;
    setDeletingId(item.id);
    try {
      const newIndex = savedList.filter(s => s.id !== item.id);
      await saveGithubFile('data/atm-worksheets/index.json', newIndex, `Delete worksheet ${item.id}`);
      setSavedList(newIndex);
    } catch(e) { alert(`Delete failed: ${e.message}`); }
    finally { setDeletingId(null); }
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
        howDuplicate, testDriveResults,
        fluidLevel, fluidSmell, fluidColor, leakLocation, atfCold, atfHot,
        gdsCode1, gdsCode2, gearD, gearL, gearR, tpsIdle, tpsWot,
        gearResults, tcc1, tcc2,
        electricOk, movementElectric, movementGas,
        techlineCase, priorAuth, techSSN,
        savedBy: currentUser, savedAt: new Date().toISOString(),
      };
      await saveGithubFile(`data/atm-worksheets/${id}.json`, data);
      const newIndex = [{ id, ro, vin, techName, repairDate, savedAt: data.savedAt }, ...savedList];
      await saveGithubFile('data/atm-worksheets/index.json', newIndex);
      setSavedList(newIndex);
      setStatus('✅ Saved! Other users can now open this worksheet.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSaving(false); }
  }

  async function loadSaved(item) {
    setStatus('⏳ Loading…');
    try {
      const d = await loadGithubFile(`data/atm-worksheets/${item.id}.json`);
      if (!d) { setStatus('❌ Could not load worksheet.'); return; }
      setRo(d.ro || ''); setDealerCode(d.dealerCode || DEALER_CODE); setTechName(d.techName || '');
      setRepairDate(d.repairDate || today); setMileage(d.mileage || ''); setVin(d.vin || '');
      setRepairType(d.repairType || ''); setRemovedPN(d.removedPN || ''); setRemovedSN(d.removedSN || '');
      setInstalledPN(d.installedPN || ''); setInstalledSN(d.installedSN || '');
      setConditionCode(d.conditionCode || ''); setSpecificCondition(d.specificCondition || '');
      setHowLong(d.howLong || ''); setHowOften(d.howOften || ''); setWhenHotCold(d.whenHotCold || '');
      setBeenInBefore(d.beenInBefore || ''); setCheckedTSB(d.checkedTSB || '');
      setHowDuplicate(d.howDuplicate || ''); setTestDriveResults(d.testDriveResults || '');
      setFluidLevel(d.fluidLevel || ''); setFluidSmell(d.fluidSmell || ''); setFluidColor(d.fluidColor || '');
      setLeakLocation(d.leakLocation || ''); setAtfCold(d.atfCold || ''); setAtfHot(d.atfHot || '');
      setGdsCode1(d.gdsCode1 || ''); setGdsCode2(d.gdsCode2 || '');
      setGearD(d.gearD || ''); setGearL(d.gearL || ''); setGearR(d.gearR || '');
      setTpsIdle(d.tpsIdle || ''); setTpsWot(d.tpsWot || '');
      setGearResults(d.gearResults || Object.fromEntries(GEARS.map(g => [g, ''])));
      setTcc1(d.tcc1 || ''); setTcc2(d.tcc2 || '');
      setElectricOk(d.electricOk || ''); setMovementElectric(d.movementElectric || ''); setMovementGas(d.movementGas || '');
      setTechlineCase(d.techlineCase || ''); setPriorAuth(d.priorAuth || ''); setTechSSN(d.techSSN || '');
      setStatus('✅ Worksheet loaded.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
  }

  const RadioRow = ({ label, value, onChange, options, name }) => (
    <div>
      <label style={lbl}>{label}</label>
      <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
        {options.map(opt => (
          <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: value === opt ? '#6ee7b7' : '#64748b', fontWeight: value === opt ? 700 : 400, fontSize: 14 }}>
            <input type="radio" name={name} checked={value === opt} onChange={() => onChange(opt)} style={{ accentColor: '#6ee7b7' }} />
            {opt}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">🔩 ATM Core Return Worksheet</div>
          <div className="adv-sub">Remanufactured ATM — SVC-H1359</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => { setShowUploads(true); refreshIndex(); }}
            style={{ background: 'rgba(139,92,246,.2)', border: '1px solid rgba(139,92,246,.5)', color: '#c4b5fd', borderRadius: 10, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>
            📂 View Uploads {savedList.length > 0 ? `(${savedList.length})` : ''}
          </button>
          <button className="secondary" onClick={onBack}>← AT Diag Worksheet</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

        {/* Basic Info */}
        <div style={section}>
          <div style={sectionTitle}>📋 Basic Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
            <Field label="Repair Order Number *" value={ro} onChange={setRo} placeholder="RO#" />
            <Field label="Dealer Code" value={dealerCode} onChange={setDealerCode} />
            <Field label="Technician Name" value={techName} onChange={setTechName} />
            <Field label="Repair Date" value={repairDate} onChange={setRepairDate} type="date" />
            <Field label="Mileage" value={mileage} onChange={setMileage} placeholder="e.g. 45000" />
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
            <Field label="Removed Part Number (XXXXX-XXXXX-XX)" value={removedPN} onChange={setRemovedPN} placeholder="e.g. 12345-67890-AB" />
            <Field label="Removed Serial Number" value={removedSN} onChange={setRemovedSN} />
            <Field label="Installed Part Number (XXXXX-XXXXX-XX)" value={installedPN} onChange={setInstalledPN} placeholder="e.g. 12345-67890-AB" />
            <Field label="Installed Serial Number" value={installedSN} onChange={setInstalledSN} />
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={lbl}>Condition Code *</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input value={conditionCode} onChange={e => setConditionCode(e.target.value)}
                placeholder="Click 'Condition Chart' to select a code" style={{ ...inp, flex: 1 }} />
              <button onClick={() => setShowConditionChart(true)}
                style={{ whiteSpace: 'nowrap', background: 'linear-gradient(135deg,rgba(251,191,36,.25),rgba(245,158,11,.18))', border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>
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
            <label style={lbl}>How long has it been occurring?</label>
            <input style={inp} value={howLong} onChange={e => setHowLong(e.target.value)} placeholder="e.g. 2 weeks" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>How often / When?</label>
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
              <label style={lbl}>Has the car been in for this condition before?</label>
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
              <label style={lbl}>Did you check for applicable TSB's?</label>
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
            <label style={lbl}>If yes, how was condition duplicated?</label>
            <input style={inp} value={howDuplicate} onChange={e => setHowDuplicate(e.target.value)} placeholder="Describe how it was duplicated…" />
          </div>
          <div>
            <label style={lbl}>Test Drive Results</label>
            <input style={inp} value={testDriveResults} onChange={e => setTestDriveResults(e.target.value)} placeholder="Describe test drive results…" />
          </div>
        </div>

        {/* Fluid & Software */}
        <div style={section}>
          <div style={sectionTitle}>🛢 Fluid Check & Software</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
            <Field label="Fluid Level" value={fluidLevel} onChange={setFluidLevel} placeholder="e.g. Normal" />
            <Field label="Fluid Smell" value={fluidSmell} onChange={setFluidSmell} placeholder="e.g. Normal" />
            <Field label="Fluid Color" value={fluidColor} onChange={setFluidColor} placeholder="e.g. Red/Clear" />
            <Field label="ATF Temp — Cold" value={atfCold} onChange={setAtfCold} placeholder="e.g. 68°F" />
            <Field label="ATF Temp — Hot" value={atfHot} onChange={setAtfHot} placeholder="e.g. 180°F" />
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label="Leaks: Location" value={leakLocation} onChange={setLeakLocation} placeholder="e.g. None / Front seal" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <Field label="GDS Code 1 (Engine & Trans Menu)" value={gdsCode1} onChange={setGdsCode1} placeholder="e.g. P0740" />
            <Field label="GDS Code 2" value={gdsCode2} onChange={setGdsCode2} placeholder="e.g. P0741" />
          </div>
        </div>

        {/* Gear Selector & TPS */}
        <div style={section}>
          <div style={sectionTitle}>📊 Gear Selector Readings & TPS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
            <Field label="D (Drive)" value={gearD} onChange={setGearD} placeholder="Reading in D" />
            <Field label="L (Low)" value={gearL} onChange={setGearL} placeholder="Reading in L" />
            <Field label="R (Reverse)" value={gearR} onChange={setGearR} placeholder="Reading in R" />
            <Field label="TPS Idle (% / V)" value={tpsIdle} onChange={setTpsIdle} placeholder="e.g. 0.5" />
            <Field label="TPS WOT (% / V)" value={tpsWot} onChange={setTpsWot} placeholder="e.g. 4.8" />
          </div>
        </div>

        {/* Gear Test Results */}
        <div style={section}>
          <div style={sectionTitle}>🏎 Test Drive Result — Per Gear</div>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 80px 90px', gap: '0 8px', marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <span style={{ ...lbl, marginBottom: 0 }}>Gear</span>
            <span style={{ ...lbl, marginBottom: 0, textAlign: 'center' }}>OK</span>
            <span style={{ ...lbl, marginBottom: 0, textAlign: 'center' }}>SLIPS</span>
          </div>
          {GEARS.map((g, i) => (
            <div key={g} style={{ display: 'grid', gridTemplateColumns: '160px 80px 90px', gap: '0 8px', alignItems: 'center', padding: '6px 0', borderBottom: i < GEARS.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', background: i % 2 === 0 ? 'rgba(255,255,255,.02)' : 'transparent', borderRadius: 4 }}>
              <span style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600, paddingLeft: 6 }}>{g}</span>
              {['OK','SLIPS'].map(opt => (
                <div key={opt} style={{ display: 'flex', justifyContent: 'center' }}>
                  <input type="radio" name={`gear-${g}`} value={opt} checked={gearResults[g] === opt}
                    onChange={() => setGearResults(prev => ({ ...prev, [g]: opt }))}
                    style={{ accentColor: opt === 'OK' ? '#4ade80' : '#fbbf24', width: 16, height: 16, cursor: 'pointer' }} />
                </div>
              ))}
            </div>
          ))}
          {/* TCC rows */}
          {[['TCC 1 (Torque Converter Clutch)', tcc1, setTcc1], ['TCC 2', tcc2, setTcc2]].map(([label, val, setter]) => (
            <div key={label} style={{ display: 'grid', gridTemplateColumns: '160px 80px 90px', gap: '0 8px', alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(251,191,36,.15)', background: 'rgba(251,191,36,.03)', borderRadius: 4, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700, paddingLeft: 6 }}>{label}</span>
              {['OK','SLIPS'].map(opt => (
                <div key={opt} style={{ display: 'flex', justifyContent: 'center' }}>
                  <input type="radio" name={`tcc-${label}`} value={opt} checked={val === opt}
                    onChange={() => setter(opt)}
                    style={{ accentColor: opt === 'OK' ? '#4ade80' : '#fbbf24', width: 16, height: 16, cursor: 'pointer' }} />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Hybrid / Electric */}
        <div style={section}>
          <div style={sectionTitle}>⚡ Hybrid / Electric Checks</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
            <RadioRow label="Electric Motor OK?" value={electricOk} onChange={setElectricOk} options={['Yes','No']} name="electricOk" />
            <RadioRow label="Movement in Electric Mode?" value={movementElectric} onChange={setMovementElectric} options={['Yes','No']} name="movElec" />
            <RadioRow label="Movement in Gas Mode?" value={movementGas} onChange={setMovementGas} options={['Yes','No']} name="movGas" />
          </div>
        </div>

        {/* Authorization */}
        <div style={section}>
          <div style={sectionTitle}>✍️ Authorization</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            <Field label="Techline Case #" value={techlineCase} onChange={setTechlineCase} />
            <Field label="Prior Authorization #" value={priorAuth} onChange={setPriorAuth} />
            <Field label="Tech SSN (last 4 digits ONLY)" value={techSSN} onChange={v => setTechSSN(v.replace(/\D/g,'').slice(0,4))} placeholder="XXXX" />
          </div>
        </div>

        {/* Status */}
        {status && (
          <div style={{ marginBottom: 16, padding: '10px 16px', background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : status.startsWith('❌') ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.05)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : status.startsWith('❌') ? 'rgba(239,68,68,.3)' : 'rgba(255,255,255,.1)'}`, borderRadius: 8, color: status.startsWith('✅') ? '#4ade80' : status.startsWith('❌') ? '#f87171' : '#94a3b8', fontSize: 13, fontWeight: 700 }}>
            {status}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ background: 'rgba(251,191,36,.2)', border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14, opacity: saving ? 0.6 : 1 }}>
            💾 {saving ? 'Uploading…' : 'Upload'}
          </button>
        </div>

        {!getGithubToken() && (
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, padding: '8px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)' }}>
            ℹ️ <strong style={{ color: '#94a3b8' }}>Print & Download work for everyone.</strong> To save worksheets to GitHub, a manager must set the GitHub token in Admin Settings.
          </div>
        )}
      </div>

      {/* Uploads Modal */}
      {showUploads && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowUploads(false)}>
          <div style={{ background: '#1e293b', border: '1px solid rgba(139,92,246,.4)', borderRadius: 18, width: '100%', maxWidth: 860, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.7)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,.08)', background: 'rgba(139,92,246,.08)', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#c4b5fd' }}>📂 Uploaded ATM Worksheets</div>
                <div style={{ fontSize: 12, color: '#7c3aed', marginTop: 2 }}>Click View to open the PDF, or Download to save it</div>
              </div>
              <button onClick={() => setShowUploads(false)}
                style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', color: '#94a3b8', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                ✕ Close
              </button>
            </div>
            <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
              {loadingList ? (
                <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: 40 }}>⏳ Loading…</div>
              ) : savedList.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 14, textAlign: 'center', padding: 40 }}>No uploaded worksheets yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {savedList.map(s => (
                    <div key={s.id} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontWeight: 900, fontSize: 15, color: '#c4b5fd', marginBottom: 4 }}>RO# {s.ro || '—'}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>VIN: {s.vin || '—'}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Tech: {s.techName || '—'} &nbsp;|&nbsp; Date: {s.repairDate || '—'}</div>
                        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>Uploaded: {s.savedAt ? new Date(s.savedAt).toLocaleString() : '—'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                        <button onClick={() => handleViewSaved(s)} disabled={pdfLoading === s.id + '_view'}
                          style={{ background: 'rgba(139,92,246,.25)', border: '1px solid rgba(139,92,246,.5)', color: '#c4b5fd', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13, opacity: pdfLoading === s.id + '_view' ? 0.6 : 1 }}>
                          {pdfLoading === s.id + '_view' ? '⏳ Opening…' : '🖨️ View / Print'}
                        </button>
                        <button onClick={() => handleDownloadSaved(s)} disabled={pdfLoading === s.id + '_dl'}
                          style={{ background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.5)', color: '#6ee7f9', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13, opacity: pdfLoading === s.id + '_dl' ? 0.6 : 1 }}>
                          {pdfLoading === s.id + '_dl' ? '⏳ Downloading…' : '⬇️ Download PDF'}
                        </button>
                        <button onClick={() => handleDeleteSaved(s)} disabled={deletingId === s.id}
                          style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.4)', color: '#f87171', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13, opacity: deletingId === s.id ? 0.5 : 1 }}>
                          {deletingId === s.id ? '⏳ Deleting…' : '🗑 Delete'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Condition Chart Modal */}
      {showConditionChart && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowConditionChart(false)}>
          <div style={{ background: '#1e293b', border: '1px solid rgba(251,191,36,.4)', borderRadius: 18, width: '100%', maxWidth: 900, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,.08)', background: 'rgba(251,191,36,.08)', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#fbbf24', letterSpacing: 1 }}>📋 ATM CONDITION CODES</div>
                <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>Click any condition to auto-fill the code</div>
              </div>
              <button onClick={() => setShowConditionChart(false)}
                style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', color: '#94a3b8', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                ✕ Close
              </button>
            </div>
            <div style={{ overflowY: 'auto', padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px', alignItems: 'start' }}>
              {ATM_CONDITION_CODES.map(group => (
                <div key={group.group} style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 900, fontSize: 11, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid rgba(251,191,36,.2)' }}>
                    {group.group}
                  </div>
                  {group.codes.map(item => (
                    <button key={`${item.code}-${item.desc}`}
                      onClick={() => { setConditionCode(item.code); setShowConditionChart(false); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', textAlign: 'left', marginBottom: 2, transition: 'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,.12)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
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
