import React, { useState, useEffect, useRef } from 'react';
import { loadGithubFile, saveGithubFile } from '../utils/github';
import { generateReviewReport, getOpenAIKey, analyzeReviewForm } from '../utils/openai';
import ReviewFormRenderer from './ReviewFormRenderer';

const section = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 };
const sectionTitle = { fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 };
const inp = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };

function btn(bg, border, color, extra = {}) {
  return { background: bg, border: `1px solid ${border}`, color, borderRadius: 10, padding: '9px 20px', cursor: 'pointer', fontWeight: 800, fontSize: 13, ...extra };
}

// ── Extract PDF text via pdf.js ──────────────────────────────────────────────
async function extractPDFText(file) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(await import('pdfjs-dist/package.json')).version}/build/pdf.worker.min.mjs`;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(item => item.str).join(' ') + '\n';
  }
  return fullText;
}

// ── Preview modal: exact tech view ──────────────────────────────────────────
function PreviewModal({ formDef, onClose }) {
  const [values, setValues] = useState({});
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px' }}>
      <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, width: '100%', maxWidth: 740, boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>

        {/* Modal header */}
        <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.15),rgba(245,158,11,.08))', borderBottom: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', padding: '18px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 17, color: '#fbbf24' }}>👁 Preview — Tech's View</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Exactly what the technician will see. You can interact with it to test.</div>
          </div>
          <button onClick={onClose} style={btn('rgba(255,255,255,.07)', 'rgba(255,255,255,.15)', '#94a3b8')}>✕ Close</button>
        </div>

        <div style={{ padding: '24px 28px' }}>
          {/* Mock topbar */}
          <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0' }}>📋 My Performance Review</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>TECHNICIAN NAME</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#64748b', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>← Technician Resources</div>
          </div>

          {/* Instructions */}
          <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.1),rgba(245,158,11,.06))', border: '1px solid rgba(251,191,36,.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 14, color: '#fbbf24', marginBottom: 4 }}>📋 Performance Self-Review</div>
            <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>Please answer each question honestly and thoroughly. Your manager will read your responses and complete their own evaluation. Once you submit, you cannot make changes.</div>
          </div>

          {/* Dynamic form */}
          <ReviewFormRenderer formDef={formDef} values={values} onChange={setValues} readOnly={false} />

          {/* Submit button (preview only) */}
          <div style={{ marginTop: 20, opacity: 0.5 }}>
            <div style={{ background: 'linear-gradient(135deg,rgba(74,222,128,.25),rgba(34,197,94,.15))', border: '2px solid rgba(74,222,128,.5)', color: '#4ade80', borderRadius: 12, padding: '14px', fontWeight: 900, fontSize: 15, textAlign: 'center' }}>
              ✅ Submit My Review
            </div>
            <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', marginTop: 6 }}>Once submitted you cannot make changes.</div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', padding: '14px 28px', borderRadius: '0 0 20px 20px', background: 'rgba(251,191,36,.04)' }}>
          <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
            👁 <strong style={{ color: '#fbbf24' }}>Preview only</strong> — interactions here are not saved. Go back and send this review to a technician when ready.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TechReview({ onBack, techList, currentUser }) {
  const [view, setView] = useState('list'); // 'list' | 'tech'
  const [selectedTech, setSelectedTech] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  // Form definition (from PDF + AI)
  const [formDef, setFormDef] = useState(null);
  const [loadingForm, setLoadingForm] = useState(true);

  // PDF upload
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const fileRef = useRef(null);

  // Pending / submissions per tech
  const [pending,     setPending]     = useState(null);
  const [submission,  setSubmission]  = useState(null);
  const [mgrReview,   setMgrReview]   = useState(null);
  const [aiReport,    setAiReport]    = useState(null);
  const [loadingTech, setLoadingTech] = useState(false);

  // Manager review
  const [mgrValues,  setMgrValues]   = useState({});
  const [savingMgr,  setSavingMgr]   = useState(false);

  // AI report
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiError,      setAiError]      = useState('');

  const [status,  setStatus]  = useState('');
  const [sending, setSending] = useState(false);

  // Load form definition on mount
  useEffect(() => {
    loadGithubFile('data/tech-reviews/form-definition.json')
      .then(d => setFormDef(d && d.sections ? d : null))
      .catch(() => setFormDef(null))
      .finally(() => setLoadingForm(false));
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

  // ── PDF Upload + AI Analysis ─────────────────────────────────────────────
  async function handlePDFUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';
    if (!file.name.toLowerCase().endsWith('.pdf')) { setPdfStatus('❌ Please upload a PDF file.'); return; }
    if (!getOpenAIKey()) { setPdfStatus('❌ Add your OpenAI API key in Admin Settings → OpenAI Settings first.'); return; }

    setPdfStatus('');
    setPdfUploading(true);
    setPdfStatus('📄 Reading PDF…');

    try {
      const text = await extractPDFText(file);
      setPdfStatus('🤖 Analyzing form structure with AI…');
      const def = await analyzeReviewForm(text);
      if (!def || !def.sections || def.sections.length === 0) throw new Error('No sections found in form.');

      // Save to GitHub
      await saveGithubFile('data/tech-reviews/form-definition.json', def, 'Upload new review form definition');
      setFormDef(def);
      setPdfStatus(`✅ Form ready! ${def.sections.length} sections, ${def.sections.reduce((n, s) => n + s.fields.length, 0)} fields extracted.`);
    } catch (err) {
      setPdfStatus(`❌ ${err.message}`);
    } finally {
      setPdfUploading(false);
    }
  }

  // ── Send / Recall ────────────────────────────────────────────────────────
  async function sendReview() {
    if (!selectedTech || !formDef) return;
    setSending(true); setStatus('⏳ Sending review…');
    try {
      const key = selectedTech.toLowerCase();
      const payload = { formDef, sentAt: new Date().toISOString(), sentBy: currentUser, techName: selectedTech };
      await saveGithubFile(`data/tech-reviews/pending/${key}.json`, payload, `Send review to ${selectedTech}`);
      setPending(payload);
      setStatus('✅ Review sent! It will appear in their Technician Resources.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSending(false); }
  }

  async function recallReview() {
    if (!selectedTech) return;
    if (!window.confirm('Recall this review? The technician will no longer see it.')) return;
    setSending(true);
    try {
      await saveGithubFile(`data/tech-reviews/pending/${selectedTech.toLowerCase()}.json`, null, `Recall review for ${selectedTech}`);
      setPending(null); setStatus('✅ Review recalled.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSending(false); }
  }

  async function saveMgrReview() {
    if (!selectedTech) return;
    setSavingMgr(true); setStatus('⏳ Saving…');
    try {
      const key = selectedTech.toLowerCase();
      const usedForm = submission?.formDef || pending?.formDef || formDef;
      const payload = { values: mgrValues, formDef: usedForm, savedBy: currentUser, savedAt: new Date().toISOString(), techName: selectedTech };
      await saveGithubFile(`data/tech-reviews/manager-reviews/${key}/latest.json`, payload, `Manager review for ${selectedTech}`);
      setMgrReview(payload);
      setStatus('✅ Manager review saved.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSavingMgr(false); }
  }

  async function handleGenerateAI() {
    if (!selectedTech || !submission) { setAiError('Waiting for tech to submit their self-review.'); return; }
    if (!getOpenAIKey()) { setAiError('No OpenAI API key set. Go to Admin Settings.'); return; }
    setGeneratingAI(true); setAiError('');
    try {
      // Flatten form values to readable text for the AI prompt
      const usedForm = submission.formDef || formDef;
      function flattenValues(def, vals) {
        if (!def) return [];
        return (def.sections || []).flatMap(s =>
          (s.fields || []).map(f => {
            const v = vals?.[f.id];
            if (f.type === 'rating_table') {
              const rows = (f.items || []).map(item => `${item.label}: ${v?.[item.id] ?? '(no rating)'}/5`).join(', ');
              return { question: f.label, answer: rows || '(no ratings)' };
            }
            return { question: f.label, answer: v !== undefined && v !== null && v !== '' ? String(v) : '(no answer)' };
          })
        );
      }
      const techQA  = flattenValues(usedForm, submission.values);
      const mgrQA   = flattenValues(usedForm, mgrReview?.values || mgrValues);
      const report  = await generateReviewReport({ techName: selectedTech, questions: techQA, techAnswers: techQA.map(q => q.answer), managerAnswers: mgrQA.map(q => q.answer) });
      const key     = selectedTech.toLowerCase();
      const payload = { report, generatedAt: new Date().toISOString(), techName: selectedTech };
      await saveGithubFile(`data/tech-reviews/reports/${key}/latest.json`, payload, `AI report for ${selectedTech}`);
      setAiReport(payload); setStatus('✅ AI report generated!');
    } catch(e) { setAiError(`❌ ${e.message}`); }
    finally { setGeneratingAI(false); }
  }

  function openTech(name) { setSelectedTech(name); setView('tech'); setStatus(''); setAiError(''); }

  // ── LIST VIEW ────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
        {showPreview && formDef && <PreviewModal formDef={formDef} onClose={() => setShowPreview(false)} />}

        <div className="adv-topbar">
          <div>
            <div className="adv-title">🔧 Technician Reviews</div>
            <div className="adv-sub">Select a technician to manage their review</div>
          </div>
          <button className="secondary" onClick={onBack}>← Employee Review</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

          {/* Form / PDF Upload Section */}
          <div style={section}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1 }}>📋 Review Form</div>
              {formDef && (
                <button onClick={() => setShowPreview(true)} style={btn('rgba(251,191,36,.15)', 'rgba(251,191,36,.4)', '#fbbf24', { display: 'flex', alignItems: 'center', gap: 6 })}>
                  👁 Preview Review
                </button>
              )}
            </div>

            {/* Upload zone */}
            <div style={{ background: 'linear-gradient(135deg,rgba(99,102,241,.1),rgba(79,70,229,.06))', border: `2px dashed ${pdfUploading ? 'rgba(99,102,241,.7)' : 'rgba(99,102,241,.4)'}`, borderRadius: 14, padding: '24px', marginBottom: formDef ? 16 : 0, textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
              <div style={{ fontWeight: 900, color: '#a5b4fc', fontSize: 15, marginBottom: 6 }}>Upload Review PDF</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
                Upload your performance review PDF. AI will read it and build an<br />interactive form with checkboxes, ratings, and text fields automatically.
              </div>
              {!getOpenAIKey() && (
                <div style={{ background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 9, padding: '8px 14px', marginBottom: 14, fontSize: 12, color: '#fbbf24' }}>
                  ⚠️ OpenAI API key required — go to <strong>Admin Settings → OpenAI Settings</strong> to add it first.
                </div>
              )}
              <input ref={fileRef} type="file" accept="application/pdf" onChange={handlePDFUpload} style={{ display: 'none' }} id="review-pdf-upload" />
              <label htmlFor="review-pdf-upload" style={{ display: 'inline-block', background: pdfUploading ? 'rgba(99,102,241,.1)' : 'rgba(99,102,241,.2)', border: '1px solid rgba(99,102,241,.5)', color: '#a5b4fc', borderRadius: 10, padding: '10px 28px', cursor: pdfUploading ? 'default' : 'pointer', fontWeight: 800, fontSize: 14 }}>
                {pdfUploading ? '⏳ Processing…' : formDef ? '🔄 Replace PDF' : '📤 Choose PDF File'}
              </label>
              {pdfStatus && (
                <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: pdfStatus.startsWith('✅') ? '#4ade80' : pdfStatus.startsWith('❌') ? '#f87171' : '#a5b4fc' }}>
                  {pdfStatus}
                </div>
              )}
            </div>

            {/* Form summary if loaded */}
            {formDef && !loadingForm && (
              <div style={{ background: 'rgba(74,222,128,.06)', border: '1px solid rgba(74,222,128,.2)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: 24 }}>✅</span>
                <div>
                  <div style={{ fontWeight: 900, color: '#4ade80', fontSize: 14 }}>{formDef.title || 'Review Form Loaded'}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    {formDef.sections.length} sections · {formDef.sections.reduce((n, s) => n + s.fields.length, 0)} fields · Click <strong style={{ color: '#fbbf24' }}>Preview Review</strong> to see what techs will see
                  </div>
                </div>
              </div>
            )}

            {loadingForm && <div style={{ color: '#64748b', fontSize: 13 }}>⏳ Loading form…</div>}
          </div>

          {/* Tech grid */}
          <div style={section}>
            <div style={sectionTitle}>👨‍🔧 Technicians</div>
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

          {status && <div style={{ padding: '10px 16px', borderRadius: 8, background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : 'rgba(239,68,68,.1)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : 'rgba(239,68,68,.3)'}`, color: status.startsWith('✅') ? '#4ade80' : '#f87171', fontSize: 13, fontWeight: 700 }}>{status}</div>}
        </div>
      </div>
    );
  }

  // ── TECH VIEW ────────────────────────────────────────────────────────────
  const activeFormDef = submission?.formDef || pending?.formDef || formDef;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {showPreview && activeFormDef && <PreviewModal formDef={activeFormDef} onClose={() => setShowPreview(false)} />}

      <div className="adv-topbar">
        <div>
          <div className="adv-title">🔧 {selectedTech} — Review</div>
          <div className="adv-sub">Performance Review Management</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {activeFormDef && <button onClick={() => setShowPreview(true)} style={btn('rgba(251,191,36,.15)', 'rgba(251,191,36,.4)', '#fbbf24')}>👁 Preview</button>}
          <button className="secondary" onClick={() => { setView('list'); setSelectedTech(null); setStatus(''); }}>← All Technicians</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        {loadingTech ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>⏳ Loading…</div>
        ) : (
          <>
            {/* Status badges */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              {[
                { label: 'Review Sent',    done: !!pending,    icon: '📤' },
                { label: 'Tech Submitted', done: !!submission, icon: '✍️' },
                { label: 'Manager Review', done: !!mgrReview,  icon: '📝' },
                { label: 'AI Report',      done: !!aiReport,   icon: '🤖' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, background: s.done ? 'rgba(74,222,128,.1)' : 'rgba(255,255,255,.05)', border: `1px solid ${s.done ? 'rgba(74,222,128,.3)' : 'rgba(255,255,255,.1)'}`, borderRadius: 20, padding: '4px 14px' }}>
                  <span>{s.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: s.done ? '#4ade80' : '#64748b' }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: s.done ? '#4ade80' : '#475569' }}>{s.done ? '✓' : '○'}</span>
                </div>
              ))}
            </div>

            {/* Send / Recall */}
            <div style={section}>
              <div style={sectionTitle}>📤 Send Review to Tech</div>
              {!formDef && !pending ? (
                <div style={{ color: '#f87171', fontSize: 13 }}>⚠️ Upload a PDF review form first (on the main list screen).</div>
              ) : pending ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 20 }}>📨</span>
                    <div>
                      <div style={{ fontWeight: 700, color: '#4ade80', fontSize: 13 }}>Review is active</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>Sent {new Date(pending.sentAt).toLocaleString()} by {pending.sentBy}</div>
                    </div>
                  </div>
                  {!submission ? (
                    <button onClick={recallReview} disabled={sending} style={btn('rgba(239,68,68,.15)', 'rgba(239,68,68,.4)', '#f87171')}>
                      {sending ? '⏳ Recalling…' : '↩ Recall Review'}
                    </button>
                  ) : (
                    <div style={{ fontSize: 12, color: '#64748b' }}>Tech has submitted — cannot recall.</div>
                  )}
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
                    This will send the current review form ({activeFormDef?.sections?.length || 0} sections) to {selectedTech}'s Technician Resources page.
                  </p>
                  <button onClick={sendReview} disabled={sending} style={btn('rgba(74,222,128,.2)', 'rgba(74,222,128,.5)', '#4ade80')}>
                    {sending ? '⏳ Sending…' : `📤 Send Review to ${selectedTech}`}
                  </button>
                </div>
              )}
            </div>

            {/* Tech's submitted review (read-only) */}
            {submission && (
              <div style={section}>
                <div style={sectionTitle}>✍️ {selectedTech}'s Self-Review</div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Submitted {new Date(submission.submittedAt).toLocaleString()}</div>
                <ReviewFormRenderer formDef={submission.formDef || formDef} values={submission.values || {}} readOnly />
              </div>
            )}

            {/* Manager review */}
            {(submission || pending) && activeFormDef && (
              <div style={section}>
                <div style={sectionTitle}>📝 Your Manager Review</div>
                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Complete the same form from your perspective as the manager.</p>
                <ReviewFormRenderer formDef={activeFormDef} values={mgrValues} onChange={setMgrValues} readOnly={false} />
                <button onClick={saveMgrReview} disabled={savingMgr} style={{ ...btn('rgba(139,92,246,.2)', 'rgba(139,92,246,.5)', '#c4b5fd'), marginTop: 20 }}>
                  {savingMgr ? '⏳ Saving…' : '💾 Save Manager Review'}
                </button>
              </div>
            )}

            {/* AI Report */}
            {(submission || mgrReview) && (
              <div style={section}>
                <div style={sectionTitle}>🤖 AI Performance Report</div>
                {aiReport ? (
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Generated {new Date(aiReport.generatedAt).toLocaleString()}</div>
                    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '16px 20px', fontSize: 14, color: '#e2e8f0', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{aiReport.report}</div>
                    <button onClick={handleGenerateAI} disabled={generatingAI} style={{ ...btn('rgba(251,191,36,.2)', 'rgba(251,191,36,.5)', '#fbbf24'), marginTop: 12 }}>
                      {generatingAI ? '⏳ Regenerating…' : '🔄 Regenerate Report'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
                      {!submission ? '⏳ Waiting for tech to submit.' : !mgrReview ? '⚠️ Save your manager review first.' : '✅ Ready — generate the AI report.'}
                    </p>
                    {aiError && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{aiError}</div>}
                    {!getOpenAIKey() && <div style={{ color: '#fbbf24', fontSize: 12, marginBottom: 12 }}>⚠️ No OpenAI key — add it in Admin Settings.</div>}
                    <button onClick={handleGenerateAI} disabled={generatingAI || !submission || !getOpenAIKey()}
                      style={btn('rgba(251,191,36,.2)', 'rgba(251,191,36,.5)', '#fbbf24', { opacity: (!submission || !getOpenAIKey()) ? 0.5 : 1 })}>
                      {generatingAI ? '⏳ Generating…' : '🤖 Generate AI Report'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {status && (
              <div style={{ padding: '10px 16px', borderRadius: 8, marginTop: 8, background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : 'rgba(239,68,68,.1)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : 'rgba(239,68,68,.3)'}`, color: status.startsWith('✅') ? '#4ade80' : '#f87171', fontSize: 13, fontWeight: 700 }}>
                {status}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
