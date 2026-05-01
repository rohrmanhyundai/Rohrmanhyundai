import React, { useState, useEffect, useRef } from 'react';
import { loadGithubFile, saveGithubFile } from '../utils/github';
import { generateReviewReport, getOpenAIKey, analyzeReviewForm } from '../utils/openai';
import ReviewFormRenderer from './ReviewFormRenderer';
import FormEditor from './FormEditor';

const section = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '22px 26px', marginBottom: 20 };
const inp = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };

function btn(bg, border, color, extra = {}) {
  return { background: bg, border: `1px solid ${border}`, color, borderRadius: 10, padding: '9px 20px', cursor: 'pointer', fontWeight: 800, fontSize: 13, ...extra };
}

// ── Extract PDF text ─────────────────────────────────────────────────────────
async function extractPDFText(file) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(await import('pdfjs-dist/package.json')).version}/build/pdf.worker.min.mjs`;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

// ── Step badge ───────────────────────────────────────────────────────────────
function StepBadge({ num, label, done, active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        background: done ? 'rgba(74,222,128,.2)' : active ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.06)',
        border: `2px solid ${done ? '#4ade80' : active ? '#60a5fa' : 'rgba(255,255,255,.15)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 900, fontSize: 13,
        color: done ? '#4ade80' : active ? '#60a5fa' : '#475569',
      }}>
        {done ? '✓' : num}
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color: done ? '#4ade80' : active ? '#e2e8f0' : '#475569' }}>{label}</span>
    </div>
  );
}

// ── Preview modal ────────────────────────────────────────────────────────────
function PreviewModal({ formDef, onClose }) {
  const [values, setValues] = useState({});
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px' }}>
      <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, width: '100%', maxWidth: 740, boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>
        <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.15),rgba(245,158,11,.08))', borderBottom: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', padding: '18px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 17, color: '#fbbf24' }}>👁 Preview — Tech's View</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Exactly what the technician will see. Interact to test it.</div>
          </div>
          <button onClick={onClose} style={btn('rgba(255,255,255,.07)', 'rgba(255,255,255,.15)', '#94a3b8')}>✕ Close</button>
        </div>
        <div style={{ padding: '24px 28px' }}>
          <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0' }}>📋 My Performance Review</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>TECHNICIAN NAME</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#64748b', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>← Technician Resources</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.1),rgba(245,158,11,.06))', border: '1px solid rgba(251,191,36,.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 14, color: '#fbbf24', marginBottom: 4 }}>📋 Performance Self-Review</div>
            <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>Please answer each question honestly and thoroughly. Your manager will read your responses and complete their own evaluation. Once you submit, you cannot make changes.</div>
          </div>
          <ReviewFormRenderer formDef={formDef} values={values} onChange={setValues} readOnly={false} />
          <div style={{ marginTop: 20, opacity: 0.5 }}>
            <div style={{ background: 'linear-gradient(135deg,rgba(74,222,128,.25),rgba(34,197,94,.15))', border: '2px solid rgba(74,222,128,.5)', color: '#4ade80', borderRadius: 12, padding: '14px', fontWeight: 900, fontSize: 15, textAlign: 'center' }}>✅ Submit My Review</div>
            <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', marginTop: 6 }}>Once submitted you cannot make changes.</div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', padding: '14px 28px', borderRadius: '0 0 20px 20px', background: 'rgba(251,191,36,.04)' }}>
          <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>👁 <strong style={{ color: '#fbbf24' }}>Preview only</strong> — nothing here is saved.</div>
        </div>
      </div>
    </div>
  );
}

export default function TechReview({ onBack, techList, currentUser }) {
  const [view, setView] = useState('list');          // 'list' | 'tech' | 'edit-tech' | 'edit-mgr'
  const [savingForm, setSavingForm] = useState(false);
  const [techTab, setTechTab] = useState('tech');    // 'tech' | 'manager' | 'report'
  const [selectedTech, setSelectedTech] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showMgrPreview, setShowMgrPreview] = useState(false);

  // Two separate form definitions
  const [techFormDef, setTechFormDef] = useState(null);   // sent to / filled by tech
  const [mgrFormDef,  setMgrFormDef]  = useState(null);   // filled by manager
  const [loadingForm, setLoadingForm] = useState(true);

  // PDF upload
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const fileRef = useRef(null);

  // Per-tech data
  const [pending,     setPending]     = useState(null);
  const [submission,  setSubmission]  = useState(null);  // tech's completed form
  const [mgrReview,   setMgrReview]   = useState(null);  // manager's completed form
  const [aiReport,    setAiReport]    = useState(null);
  const [loadingTech, setLoadingTech] = useState(false);

  // Manager evaluation form values (in-progress)
  const [mgrValues,  setMgrValues]  = useState({});
  const [savingMgr,  setSavingMgr]  = useState(false);

  // AI
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiError,      setAiError]      = useState('');

  const [status,  setStatus]  = useState('');
  const [sending, setSending] = useState(false);

  // Load both form definitions
  useEffect(() => {
    Promise.all([
      loadGithubFile('data/tech-reviews/tech-form-definition.json').catch(() => null),
      loadGithubFile('data/tech-reviews/mgr-form-definition.json').catch(() => null),
    ]).then(([td, md]) => {
      setTechFormDef(td?.sections ? td : null);
      setMgrFormDef(md?.sections ? md : null);
    }).finally(() => setLoadingForm(false));
  }, []);

  // Load per-tech data
  useEffect(() => {
    if (!selectedTech) return;
    setLoadingTech(true);
    setSubmission(null); setMgrReview(null); setAiReport(null); setPending(null); setMgrValues({});
    const key = selectedTech.toLowerCase();
    Promise.all([
      loadGithubFile(`data/tech-reviews/pending/${key}.json`).catch(() => null),
      loadGithubFile(`data/tech-reviews/submissions/${key}/latest.json`).catch(() => null),
      loadGithubFile(`data/tech-reviews/manager-reviews/${key}/latest.json`).catch(() => null),
      loadGithubFile(`data/tech-reviews/reports/${key}/latest.json`).catch(() => null),
    ]).then(([pend, sub, mgr, report]) => {
      setPending(pend);
      setSubmission(sub);
      setMgrReview(mgr);
      setAiReport(report);
      setMgrValues(mgr?.values || {});
    }).finally(() => setLoadingTech(false));
  }, [selectedTech]);

  // ── PDF Upload + AI Analysis (creates BOTH forms from same PDF) ─────────────
  async function handlePDFUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';
    if (!file.name.toLowerCase().endsWith('.pdf')) { setPdfStatus('❌ Please upload a PDF file.'); return; }
    if (!getOpenAIKey()) { setPdfStatus('❌ Add your OpenAI API key in Admin Settings → OpenAI Settings first.'); return; }
    setPdfStatus(''); setPdfUploading(true); setPdfStatus('📄 Reading PDF…');
    try {
      const text = await extractPDFText(file);
      setPdfStatus('🤖 AI is analyzing the form structure…');
      const def = await analyzeReviewForm(text);
      if (!def?.sections?.length) throw new Error('No sections found in form.');
      // Save same base form to both files — manager can edit each independently
      await Promise.all([
        saveGithubFile('data/tech-reviews/tech-form-definition.json', def, 'Upload tech review form'),
        saveGithubFile('data/tech-reviews/mgr-form-definition.json',  def, 'Upload manager review form'),
      ]);
      setTechFormDef(def);
      setMgrFormDef(def);
      const fc = def.sections.reduce((n, s) => n + s.fields.length, 0);
      setPdfStatus(`✅ Both forms built — ${def.sections.length} sections, ${fc} fields. Edit each form separately below.`);
    } catch (err) {
      setPdfStatus(`❌ ${err.message}`);
    } finally {
      setPdfUploading(false);
    }
  }

  // ── Send / Recall ─────────────────────────────────────────────────────────
  async function sendReview() {
    if (!selectedTech || !techFormDef) return;
    setSending(true); setStatus('⏳ Sending…');
    try {
      const key = selectedTech.toLowerCase();
      const payload = { formDef: techFormDef, sentAt: new Date().toISOString(), sentBy: currentUser, techName: selectedTech };
      await saveGithubFile(`data/tech-reviews/pending/${key}.json`, payload, `Send review to ${selectedTech}`);
      setPending(payload);
      setStatus('✅ Review sent to technician.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSending(false); }
  }

  async function recallReview() {
    if (!selectedTech) return;
    if (!window.confirm('Withdraw this survey? The technician will no longer see it in their Technician Resources.')) return;
    setSending(true);
    try {
      await saveGithubFile(`data/tech-reviews/pending/${selectedTech.toLowerCase()}.json`, null, `Recall review for ${selectedTech}`);
      setPending(null); setStatus('✅ Review recalled.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSending(false); }
  }

  // ── Save manager evaluation ───────────────────────────────────────────────
  async function saveMgrReview() {
    if (!selectedTech) return;
    setSavingMgr(true); setStatus('⏳ Saving manager evaluation…');
    try {
      const key = selectedTech.toLowerCase();
      const usedForm = mgrReview?.formDef || mgrFormDef;
      const payload = { values: mgrValues, formDef: usedForm, savedBy: currentUser, savedAt: new Date().toISOString(), techName: selectedTech };
      await saveGithubFile(`data/tech-reviews/manager-reviews/${key}/latest.json`, payload, `Manager evaluation for ${selectedTech}`);
      setMgrReview(payload);
      setStatus('✅ Manager evaluation saved.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSavingMgr(false); }
  }

  // ── Generate AI report ────────────────────────────────────────────────────
  async function handleGenerateAI() {
    if (!submission) { setAiError('Tech has not submitted their self-evaluation yet.'); return; }
    if (!mgrReview) { setAiError('Save your manager evaluation first.'); return; }
    if (!getOpenAIKey()) { setAiError('No OpenAI API key — add it in Admin Settings.'); return; }
    setGeneratingAI(true); setAiError('');
    try {
      const usedForm = submission.formDef || techFormDef;
      function flatten(def, vals) {
        if (!def) return [];
        return (def.sections || []).flatMap(s =>
          (s.fields || []).map(f => {
            const v = vals?.[f.id];
            if (f.type === 'rating_table') {
              const rows = (f.items || []).map(item => `${item.label}: ${v?.[item.id] ?? '(no rating)'}/5`).join(', ');
              return { question: f.label, answer: rows || '(no ratings)' };
            }
            return { question: f.label, answer: v != null && v !== '' ? String(v) : '(no answer)' };
          })
        );
      }
      const techQA = flatten(usedForm, submission.values);
      const mgrQA  = flatten(usedForm, mgrReview.values);
      const report = await generateReviewReport({
        techName: selectedTech,
        questions: techQA,
        techAnswers: techQA.map(q => q.answer),
        managerAnswers: mgrQA.map(q => q.answer),
      });
      const key = selectedTech.toLowerCase();
      const payload = { report, generatedAt: new Date().toISOString(), techName: selectedTech };
      await saveGithubFile(`data/tech-reviews/reports/${key}/latest.json`, payload, `AI report for ${selectedTech}`);
      setAiReport(payload);
      setStatus('✅ AI report generated!');
    } catch(e) { setAiError(`❌ ${e.message}`); }
    finally { setGeneratingAI(false); }
  }

  function openTech(name) {
    setSelectedTech(name);
    setView('tech');
    setTechTab('tech');
    setStatus(''); setAiError('');
  }

  async function handleSaveTechForm(def) {
    setSavingForm(true);
    try {
      await saveGithubFile('data/tech-reviews/tech-form-definition.json', def, 'Update tech review form');
      setTechFormDef(def);
      setView('list');
      setPdfStatus('✅ Tech form saved!');
    } catch(e) { alert('Failed to save: ' + e.message); }
    finally { setSavingForm(false); }
  }

  async function handleSaveMgrForm(def) {
    setSavingForm(true);
    try {
      await saveGithubFile('data/tech-reviews/mgr-form-definition.json', def, 'Update manager review form');
      setMgrFormDef(def);
      setView('list');
      setPdfStatus('✅ Manager form saved!');
    } catch(e) { alert('Failed to save: ' + e.message); }
    finally { setSavingForm(false); }
  }

  // ── EDIT VIEWS ────────────────────────────────────────────────────────────
  if (view === 'edit-tech') {
    return (
      <FormEditor
        initialDef={techFormDef}
        title="✏️ Edit Tech Self-Evaluation Form"
        subtitle="This is the form sent to the technician to fill out about themselves"
        onSave={handleSaveTechForm}
        onCancel={() => setView('list')}
        saving={savingForm}
      />
    );
  }

  if (view === 'edit-mgr') {
    return (
      <FormEditor
        initialDef={mgrFormDef}
        title="✏️ Edit Manager Evaluation Form"
        subtitle="This is the form you fill out about each technician — not seen by the tech"
        onSave={handleSaveMgrForm}
        onCancel={() => setView('list')}
        saving={savingForm}
      />
    );
  }

  // ── LIST VIEW ─────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
        {showPreview    && techFormDef && <PreviewModal formDef={techFormDef} onClose={() => setShowPreview(false)} />}
        {showMgrPreview && mgrFormDef  && <PreviewModal formDef={mgrFormDef}  onClose={() => setShowMgrPreview(false)} />}

        <div className="adv-topbar">
          <div>
            <div className="adv-title">🔧 Technician Reviews</div>
            <div className="adv-sub">Upload a review form, then select a technician</div>
          </div>
          <button className="secondary" onClick={onBack}>← Employee Review</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

          {/* PDF Upload */}
          <div style={section}>
            <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>📄 Upload Review PDF</div>

            <div style={{ background: 'linear-gradient(135deg,rgba(99,102,241,.1),rgba(79,70,229,.06))', border: `2px dashed ${pdfUploading ? 'rgba(99,102,241,.7)' : 'rgba(99,102,241,.4)'}`, borderRadius: 14, padding: '24px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
              <div style={{ fontWeight: 900, color: '#a5b4fc', fontSize: 15, marginBottom: 6 }}>Upload Review PDF</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
                AI reads your PDF and creates <strong style={{ color: '#a5b4fc' }}>two separate editable forms</strong> — one for the tech and one for the manager.<br />
                <span style={{ fontSize: 12, color: '#475569' }}>Customize each one independently after uploading.</span>
              </div>
              {!getOpenAIKey() && (
                <div style={{ background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 9, padding: '8px 14px', marginBottom: 14, fontSize: 12, color: '#fbbf24' }}>
                  ⚠️ OpenAI API key required — go to <strong>Admin Settings → OpenAI Settings</strong>
                </div>
              )}
              <input ref={fileRef} type="file" accept="application/pdf" onChange={handlePDFUpload} style={{ display: 'none' }} id="review-pdf-upload" />
              <label htmlFor="review-pdf-upload" style={{ display: 'inline-block', background: pdfUploading ? 'rgba(99,102,241,.1)' : 'rgba(99,102,241,.2)', border: '1px solid rgba(99,102,241,.5)', color: '#a5b4fc', borderRadius: 10, padding: '10px 28px', cursor: pdfUploading ? 'default' : 'pointer', fontWeight: 800, fontSize: 14 }}>
                {pdfUploading ? '⏳ Processing…' : (techFormDef || mgrFormDef) ? '🔄 Re-upload PDF (resets both forms)' : '📤 Choose PDF File'}
              </label>
              {pdfStatus && (
                <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: pdfStatus.startsWith('✅') ? '#4ade80' : pdfStatus.startsWith('❌') ? '#f87171' : '#a5b4fc' }}>{pdfStatus}</div>
              )}
            </div>
          </div>

          {/* Two form cards side by side */}
          {!loadingForm && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 20 }}>

              {/* Tech form card */}
              <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${techFormDef ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.08)'}`, borderRadius: 14, padding: '20px 22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 22 }}>✍️</span>
                  <div style={{ fontWeight: 900, fontSize: 14, color: '#60a5fa' }}>Tech Self-Evaluation Form</div>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
                  Sent to the technician. They fill it out about themselves. Edit the questions, skill level descriptions, and rating areas.
                </div>
                {techFormDef ? (
                  <>
                    <div style={{ fontSize: 12, color: '#4ade80', marginBottom: 14 }}>
                      ✅ {techFormDef.sections?.length || 0} sections · {techFormDef.sections?.reduce((n, s) => n + s.fields.length, 0) || 0} fields loaded
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setView('edit-tech')} style={btn('rgba(96,165,250,.15)', 'rgba(96,165,250,.4)', '#60a5fa')}>✏️ Edit</button>
                      <button onClick={() => setShowPreview(true)} style={btn('rgba(251,191,36,.1)', 'rgba(251,191,36,.3)', '#fbbf24')}>👁 Preview</button>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#334155', fontStyle: 'italic' }}>Upload a PDF above to create this form.</div>
                )}
              </div>

              {/* Manager form card */}
              <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${mgrFormDef ? 'rgba(167,139,250,.3)' : 'rgba(255,255,255,.08)'}`, borderRadius: 14, padding: '20px 22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 22 }}>📝</span>
                  <div style={{ fontWeight: 900, fontSize: 14, color: '#a78bfa' }}>Manager Evaluation Form</div>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
                  Only you fill this out. Add manager-specific questions, rating categories, or notes that the tech never sees.
                </div>
                {mgrFormDef ? (
                  <>
                    <div style={{ fontSize: 12, color: '#4ade80', marginBottom: 14 }}>
                      ✅ {mgrFormDef.sections?.length || 0} sections · {mgrFormDef.sections?.reduce((n, s) => n + s.fields.length, 0) || 0} fields loaded
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setView('edit-mgr')} style={btn('rgba(167,139,250,.15)', 'rgba(167,139,250,.4)', '#a78bfa')}>✏️ Edit</button>
                      <button onClick={() => setShowMgrPreview(true)} style={btn('rgba(251,191,36,.1)', 'rgba(251,191,36,.3)', '#fbbf24')}>👁 Preview</button>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#334155', fontStyle: 'italic' }}>Upload a PDF above to create this form.</div>
                )}
              </div>
            </div>
          )}
          {loadingForm && <div style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>⏳ Loading forms…</div>}

          {/* Tech grid */}
          <div style={section}>
            <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>👨‍🔧 Technicians</div>
            {!techList || techList.length === 0 ? (
              <div style={{ color: '#475569', fontSize: 14, textAlign: 'center', padding: 20 }}>No technicians found. Make sure users have the "technician" role in Admin Settings.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
                {techList.map(name => (
                  <button key={name} onClick={() => openTech(name)}
                    style={{ background: 'linear-gradient(135deg,rgba(251,146,60,.2),rgba(249,115,22,.12))', border: '2px solid rgba(251,146,60,.4)', borderRadius: 14, padding: '20px 16px', cursor: 'pointer', textAlign: 'center', transition: 'transform .15s' }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseLeave={e => e.currentTarget.style.transform = ''}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>👷</div>
                    <div style={{ fontWeight: 900, fontSize: 15, color: '#fdba74' }}>{name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Click to manage review</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── TECH VIEW ─────────────────────────────────────────────────────────────
  const activeTechForm = submission?.formDef || pending?.formDef || techFormDef;
  const activeMgrForm  = mgrReview?.formDef  || mgrFormDef;
  const techDone = !!submission;
  const mgrDone  = !!mgrReview;
  const bothDone = techDone && mgrDone;

  const TABS = [
    { id: 'tech',    label: '✍️ Tech Self-Evaluation',    done: techDone },
    { id: 'manager', label: '📝 Manager Evaluation',       done: mgrDone  },
    { id: 'report',  label: '🤖 AI Report',                done: !!aiReport, locked: !bothDone },
  ];

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {showPreview    && activeTechForm && <PreviewModal formDef={activeTechForm} onClose={() => setShowPreview(false)} />}
      {showMgrPreview && activeMgrForm  && <PreviewModal formDef={activeMgrForm}  onClose={() => setShowMgrPreview(false)} />}

      <div className="adv-topbar">
        <div>
          <div className="adv-title">🔧 {selectedTech}</div>
          <div className="adv-sub">Performance Review</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="secondary" onClick={() => { setView('list'); setSelectedTech(null); setStatus(''); }}>← All Technicians</button>
        </div>
      </div>

      {loadingTech ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 15 }}>⏳ Loading…</div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          {/* Progress bar */}
          <div style={{ padding: '16px 32px 0', background: 'rgba(0,0,0,.2)', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', gap: 24, flexShrink: 0 }}>
            <StepBadge num={1} label="Tech Self-Evaluation" done={techDone} active={!techDone} />
            <div style={{ flex: 1, height: 2, background: techDone ? 'rgba(74,222,128,.4)' : 'rgba(255,255,255,.08)', borderRadius: 2 }} />
            <StepBadge num={2} label="Manager Evaluation" done={mgrDone} active={techDone && !mgrDone} />
            <div style={{ flex: 1, height: 2, background: mgrDone ? 'rgba(74,222,128,.4)' : 'rgba(255,255,255,.08)', borderRadius: 2 }} />
            <StepBadge num={3} label="AI Report" done={!!aiReport} active={bothDone && !aiReport} />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, padding: '12px 32px 0', borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
            {TABS.map(tab => {
              const active = techTab === tab.id;
              return (
                <button key={tab.id}
                  onClick={() => !tab.locked && setTechTab(tab.id)}
                  style={{
                    background: active ? 'rgba(255,255,255,.08)' : 'transparent',
                    border: 'none',
                    borderBottom: active ? '2px solid #60a5fa' : '2px solid transparent',
                    color: tab.locked ? '#334155' : tab.done ? '#4ade80' : active ? '#e2e8f0' : '#64748b',
                    padding: '10px 20px',
                    cursor: tab.locked ? 'not-allowed' : 'pointer',
                    fontWeight: 800, fontSize: 13,
                    display: 'flex', alignItems: 'center', gap: 6,
                    borderRadius: '8px 8px 0 0',
                    transition: 'all .15s',
                  }}>
                  {tab.label}
                  {tab.done && <span style={{ fontSize: 10, background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.4)', color: '#4ade80', borderRadius: 20, padding: '1px 8px' }}>Done</span>}
                  {tab.locked && <span style={{ fontSize: 10, color: '#334155' }}>🔒</span>}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

            {/* ── TAB: Tech Self-Evaluation ── */}
            {techTab === 'tech' && (
              <div>
                {/* Send / Recall panel */}
                <div style={section}>
                  <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 10 }}>📤 Send Review to Technician</div>
                  {!techFormDef && !pending ? (
                    <div style={{ color: '#f87171', fontSize: 13 }}>⚠️ Go back and upload a review PDF first.</div>
                  ) : pending && !submission ? (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(74,222,128,.07)', border: '1px solid rgba(74,222,128,.2)', borderRadius: 10, padding: '14px 18px', marginBottom: 14 }}>
                        <span style={{ fontSize: 22 }}>📨</span>
                        <div>
                          <div style={{ fontWeight: 800, color: '#4ade80', fontSize: 13 }}>Review sent — waiting for tech to complete</div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Sent {new Date(pending.sentAt).toLocaleString()} by {pending.sentBy}</div>
                        </div>
                      </div>
                      <button onClick={recallReview} disabled={sending}
                        style={btn('rgba(239,68,68,.15)', 'rgba(239,68,68,.4)', '#f87171')}>
                        {sending ? '⏳ Withdrawing…' : '↩ Withdraw Survey'}
                      </button>
                    </div>
                  ) : submission ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(74,222,128,.07)', border: '1px solid rgba(74,222,128,.2)', borderRadius: 10, padding: '14px 18px' }}>
                      <span style={{ fontSize: 22 }}>✅</span>
                      <div>
                        <div style={{ fontWeight: 800, color: '#4ade80', fontSize: 13 }}>Technician has submitted their self-evaluation</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Submitted {new Date(submission.submittedAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
                        This sends the review form to <strong style={{ color: '#fdba74' }}>{selectedTech}</strong>'s Technician Resources page. They will see a "My Review" button to fill it out.
                      </p>
                      {!techFormDef ? (
                        <div style={{ color: '#f87171', fontSize: 13 }}>⚠️ Upload a review PDF first.</div>
                      ) : (
                        <button onClick={sendReview} disabled={sending} style={btn('rgba(74,222,128,.2)', 'rgba(74,222,128,.5)', '#4ade80')}>
                          {sending ? '⏳ Sending…' : `📤 Send Review to ${selectedTech}`}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Tech's submitted answers (read-only) */}
                {submission && (
                  <div style={section}>
                    <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 10 }}>
                      ✍️ {selectedTech}'s Self-Evaluation Answers
                    </div>
                    <ReviewFormRenderer formDef={submission.formDef || techFormDef} values={submission.values || {}} readOnly />
                  </div>
                )}

                {status && techTab === 'tech' && (
                  <div style={{ padding: '10px 16px', borderRadius: 8, marginTop: 8, background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : 'rgba(239,68,68,.1)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : 'rgba(239,68,68,.3)'}`, color: status.startsWith('✅') ? '#4ade80' : '#f87171', fontSize: 13, fontWeight: 700 }}>{status}</div>
                )}
              </div>
            )}

            {/* ── TAB: Manager Evaluation ── */}
            {techTab === 'manager' && (
              <div>
                <div style={{ background: 'linear-gradient(135deg,rgba(139,92,246,.1),rgba(109,40,217,.06))', border: '1px solid rgba(139,92,246,.3)', borderRadius: 14, padding: '18px 22px', marginBottom: 22 }}>
                  <div style={{ fontWeight: 900, fontSize: 15, color: '#c4b5fd', marginBottom: 4 }}>📝 Your Manager Evaluation of {selectedTech}</div>
                  <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
                    Fill out the same form from your perspective as the manager. This is your independent evaluation — fill it out honestly based on your observations of this technician's performance. You can save your progress and come back anytime.
                  </div>
                </div>

                {!activeMgrForm ? (
                  <div style={{ color: '#f87171', fontSize: 13 }}>⚠️ Upload a review PDF first.</div>
                ) : (
                  <>
                    {mgrReview && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(74,222,128,.07)', border: '1px solid rgba(74,222,128,.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 18 }}>
                        <span>✅</span>
                        <div style={{ fontSize: 13, color: '#4ade80', fontWeight: 700 }}>Manager evaluation saved — last updated {new Date(mgrReview.savedAt).toLocaleString()}</div>
                      </div>
                    )}

                    <ReviewFormRenderer
                      formDef={activeMgrForm}
                      values={mgrValues}
                      onChange={setMgrValues}
                      readOnly={false}
                    />

                    <button onClick={saveMgrReview} disabled={savingMgr}
                      style={{ ...btn('rgba(139,92,246,.2)', 'rgba(139,92,246,.5)', '#c4b5fd'), marginTop: 20, padding: '12px 32px', fontSize: 14 }}>
                      {savingMgr ? '⏳ Saving…' : mgrReview ? '💾 Update Manager Evaluation' : '💾 Save Manager Evaluation'}
                    </button>

                    {!bothDone && (
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 10 }}>
                        {!techDone ? '⏳ Once the tech submits their self-evaluation, you can generate the AI report.' : '✅ Tech has submitted. Save your evaluation above to unlock the AI report.'}
                      </div>
                    )}
                    {bothDone && !aiReport && (
                      <div style={{ marginTop: 14, background: 'rgba(74,222,128,.06)', border: '1px solid rgba(74,222,128,.2)', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#4ade80', fontWeight: 700 }}>
                        ✅ Both evaluations complete — go to the <button onClick={() => setTechTab('report')} style={{ background: 'none', border: 'none', color: '#fbbf24', fontWeight: 900, cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>🤖 AI Report</button> tab to generate the professional review.
                      </div>
                    )}
                  </>
                )}

                {status && techTab === 'manager' && (
                  <div style={{ padding: '10px 16px', borderRadius: 8, marginTop: 12, background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : 'rgba(239,68,68,.1)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : 'rgba(239,68,68,.3)'}`, color: status.startsWith('✅') ? '#4ade80' : '#f87171', fontSize: 13, fontWeight: 700 }}>{status}</div>
                )}
              </div>
            )}

            {/* ── TAB: AI Report ── */}
            {techTab === 'report' && (
              <div>
                {!bothDone ? (
                  <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                    <div style={{ fontSize: 52, marginBottom: 16 }}>🔒</div>
                    <div style={{ fontWeight: 900, fontSize: 18, color: '#475569', marginBottom: 10 }}>Both Evaluations Required</div>
                    <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.7 }}>
                      The AI report requires both evaluations to be complete before it can be generated.<br />
                      <span style={{ color: techDone ? '#4ade80' : '#f87171' }}>{techDone ? '✅' : '○'} Tech self-evaluation</span>{' · '}
                      <span style={{ color: mgrDone ? '#4ade80' : '#f87171' }}>{mgrDone ? '✅' : '○'} Manager evaluation</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* Ready banner */}
                    <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.12),rgba(245,158,11,.07))', border: '1px solid rgba(251,191,36,.3)', borderRadius: 14, padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 18 }}>
                      <span style={{ fontSize: 36 }}>🤖</span>
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 16, color: '#fbbf24', marginBottom: 4 }}>Ready to Generate AI Report</div>
                        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
                          Both evaluations are complete. The AI will compare {selectedTech}'s self-evaluation against your manager evaluation and write a professional HR performance review report.
                        </div>
                      </div>
                    </div>

                    {aiReport ? (
                      <div style={section}>
                        <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 10 }}>
                          📄 Generated Report
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Generated {new Date(aiReport.generatedAt).toLocaleString()}</div>
                        <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, padding: '20px 24px', fontSize: 14, color: '#e2e8f0', lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
                          {aiReport.report}
                        </div>
                        <button onClick={handleGenerateAI} disabled={generatingAI} style={{ ...btn('rgba(251,191,36,.2)', 'rgba(251,191,36,.5)', '#fbbf24'), marginTop: 16 }}>
                          {generatingAI ? '⏳ Regenerating…' : '🔄 Regenerate Report'}
                        </button>
                      </div>
                    ) : (
                      <div style={section}>
                        {aiError && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 14, fontWeight: 700 }}>{aiError}</div>}
                        {!getOpenAIKey() && (
                          <div style={{ background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 9, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#fbbf24' }}>
                            ⚠️ OpenAI API key required — go to <strong>Admin Settings → OpenAI Settings</strong>
                          </div>
                        )}
                        <button
                          onClick={handleGenerateAI}
                          disabled={generatingAI || !getOpenAIKey()}
                          style={{ ...btn('rgba(251,191,36,.2)', 'rgba(251,191,36,.5)', '#fbbf24', { padding: '14px 40px', fontSize: 15 }), opacity: !getOpenAIKey() ? 0.5 : 1 }}>
                          {generatingAI ? '⏳ Generating Professional Report…' : '🤖 Generate AI Performance Report'}
                        </button>
                        {generatingAI && <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>This usually takes 15–30 seconds…</div>}
                      </div>
                    )}

                    {status && techTab === 'report' && (
                      <div style={{ padding: '10px 16px', borderRadius: 8, marginTop: 8, background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : 'rgba(239,68,68,.1)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : 'rgba(239,68,68,.3)'}`, color: status.startsWith('✅') ? '#4ade80' : '#f87171', fontSize: 13, fontWeight: 700 }}>{status}</div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
