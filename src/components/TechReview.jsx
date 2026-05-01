import React, { useState, useEffect, useRef } from 'react';
import { loadGithubFile, saveGithubFile } from '../utils/github';
import { generateReviewReport, getOpenAIKey } from '../utils/openai';

const section = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 };
const sectionTitle = { fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 };
const inp = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };

function btn(bg, border, color, extra = {}) {
  return { background: bg, border: `1px solid ${border}`, color, borderRadius: 10, padding: '9px 20px', cursor: 'pointer', fontWeight: 800, fontSize: 13, ...extra };
}

// ── Extract text from a PDF file using pdf.js ──────────────────────────────
async function extractPDFText(file) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  // Use the bundled worker via CDN to avoid Vite worker config issues
  GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(await import('pdfjs-dist/package.json')).version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = content.items.map(item => item.str).join(' ');
    fullText += lines + '\n';
  }
  return fullText;
}

// ── Parse questions from raw PDF text ─────────────────────────────────────
function parseQuestionsFromText(text) {
  const lines = text.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
  const questions = [];

  // Match patterns like:
  //   1. Question text
  //   1) Question text
  //   Q1: Question text
  //   Q1. Question text
  //   • Question text  (bullets)
  //   Any line ending with ?
  const numberedPattern = /^(?:Q\s*\.?\s*)?(\d+)[.):\-]\s*(.+)/i;
  const bulletPattern   = /^[•\-\*▪◦]\s*(.+)/;

  for (const line of lines) {
    // Skip very short lines or lines that look like headers / page numbers
    if (line.length < 10) continue;

    const numMatch = line.match(numberedPattern);
    if (numMatch) {
      const q = numMatch[2].trim();
      if (q.length > 5) { questions.push(q); continue; }
    }

    const bulletMatch = line.match(bulletPattern);
    if (bulletMatch) {
      const q = bulletMatch[1].trim();
      if (q.length > 10) { questions.push(q); continue; }
    }

    // Any line that ends with a question mark and is reasonably long
    if (line.endsWith('?') && line.length > 15) {
      questions.push(line);
    }
  }

  return [...new Set(questions)]; // deduplicate
}

// ── Preview: what the tech sees ───────────────────────────────────────────
function ReviewPreview({ questions, onClose }) {
  const [answers, setAnswers] = useState(questions.map(() => ''));
  const inpStyle = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 24px' }}>
      <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, width: '100%', maxWidth: 720, boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>

        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.15),rgba(245,158,11,.08))', borderBottom: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, color: '#fbbf24', marginBottom: 2 }}>👁 Preview — What the Tech Sees</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>This is exactly how the review will appear to the technician. You can type sample answers to test it.</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', color: '#94a3b8', borderRadius: 10, padding: '8px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>✕ Close Preview</button>
        </div>

        {/* Simulated tech review form */}
        <div style={{ padding: '28px' }}>

          {/* Mock topbar */}
          <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 18px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, color: '#e2e8f0' }}>📋 My Performance Review</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>TECHNICIAN NAME</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#64748b', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700 }}>← Technician Resources</div>
          </div>

          {/* Instructions banner */}
          <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.1),rgba(245,158,11,.06))', border: '1px solid rgba(251,191,36,.3)', borderRadius: 14, padding: '18px 22px', marginBottom: 24 }}>
            <div style={{ fontWeight: 900, fontSize: 15, color: '#fbbf24', marginBottom: 5 }}>📋 Performance Self-Review</div>
            <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>Please answer each question honestly and thoroughly. Your manager will read your responses and complete their own evaluation. Once you submit, you cannot make changes.</div>
          </div>

          {/* Questions */}
          {questions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#475569', fontSize: 14 }}>No questions yet — upload a PDF or add questions manually.</div>
          ) : (
            questions.map((q, i) => (
              <div key={i} style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Question {i + 1} of {questions.length}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>{q.question || q}</div>
                <textarea
                  value={answers[i] || ''}
                  onChange={e => { const a = [...answers]; a[i] = e.target.value; setAnswers(a); }}
                  rows={4}
                  placeholder="Type your answer here…"
                  style={inpStyle}
                />
              </div>
            ))
          )}

          {/* Submit button (disabled — just for show) */}
          {questions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ background: 'linear-gradient(135deg,rgba(74,222,128,.25),rgba(34,197,94,.15))', border: '2px solid rgba(74,222,128,.5)', color: '#4ade80', borderRadius: 12, padding: '14px 32px', fontWeight: 900, fontSize: 15, textAlign: 'center', opacity: 0.6 }}>
                ✅ Submit My Review
              </div>
              <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', marginTop: 8 }}>Once submitted you cannot make changes.</div>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', padding: '16px 28px', borderRadius: '0 0 20px 20px', background: 'rgba(251,191,36,.05)' }}>
          <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
            👁 This is a <strong style={{ color: '#fbbf24' }}>preview only</strong> — answers typed here are not saved. Close and click <strong style={{ color: '#fbbf24' }}>Send Review</strong> on a technician to send the real form.
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

  // Questions management
  const [questions, setQuestions]   = useState([]);
  const [loadingQ, setLoadingQ]     = useState(true);
  const [newQ, setNewQ]             = useState('');
  const [savingQ, setSavingQ]       = useState(false);

  // PDF upload state
  const [pdfUploading, setPdfUploading]         = useState(false);
  const [pdfPreview, setPdfPreview]             = useState(null);  // extracted questions before confirm
  const [pdfPreviewEdits, setPdfPreviewEdits]   = useState([]);
  const [showPdfPreview, setShowPdfPreview]     = useState(false);
  const [pdfError, setPdfError]                 = useState('');
  const fileRef = useRef(null);

  // Pending / submissions
  const [pending,      setPending]      = useState(null);
  const [submission,   setSubmission]   = useState(null);
  const [mgrReview,    setMgrReview]    = useState(null);
  const [aiReport,     setAiReport]     = useState(null);
  const [loadingTech,  setLoadingTech]  = useState(false);

  // Manager review answers
  const [mgrAnswers,   setMgrAnswers]   = useState([]);
  const [savingMgr,    setSavingMgr]    = useState(false);

  // AI
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiError,      setAiError]      = useState('');

  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);

  // Load questions on mount
  useEffect(() => {
    loadGithubFile('data/tech-reviews/questions.json')
      .then(d => setQuestions(Array.isArray(d) ? d : []))
      .catch(() => setQuestions([]))
      .finally(() => setLoadingQ(false));
  }, []);

  // Load tech-specific data when a tech is selected
  useEffect(() => {
    if (!selectedTech) return;
    setLoadingTech(true);
    setSubmission(null); setMgrReview(null); setAiReport(null); setPending(null); setMgrAnswers([]);
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
      if (mgr?.answers) setMgrAnswers(mgr.answers);
      else if (sub?.questions) setMgrAnswers(sub.questions.map(() => ''));
      else if (pend?.questions) setMgrAnswers(pend.questions.map(() => ''));
      else setMgrAnswers(questions.map(() => ''));
    }).finally(() => setLoadingTech(false));
  }, [selectedTech]);

  function openTech(name) {
    setSelectedTech(name);
    setView('tech');
    setStatus('');
    setAiError('');
  }

  async function saveQuestions(qs) {
    setSavingQ(true);
    try {
      await saveGithubFile('data/tech-reviews/questions.json', qs, 'Update review questions');
      setQuestions(qs);
      setStatus('✅ Questions saved.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSavingQ(false); }
  }

  function addQuestion() {
    if (!newQ.trim()) return;
    const updated = [...questions, { question: newQ.trim(), type: 'text' }];
    setNewQ('');
    saveQuestions(updated);
  }

  function removeQuestion(i) {
    saveQuestions(questions.filter((_, idx) => idx !== i));
  }

  function moveQuestion(i, dir) {
    const qs = [...questions];
    const j = i + dir;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    saveQuestions(qs);
  }

  // ── PDF Upload Handler ────────────────────────────────────────────────────
  async function handlePDFUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Please upload a PDF file.');
      return;
    }
    setPdfError('');
    setPdfUploading(true);
    try {
      const text = await extractPDFText(file);
      const extracted = parseQuestionsFromText(text);
      if (extracted.length === 0) {
        setPdfError('No questions could be found in this PDF. Try a PDF with numbered questions (1. Question text) or questions ending with ?');
        setPdfUploading(false);
        return;
      }
      // Show preview for confirmation / editing
      setPdfPreview(extracted);
      setPdfPreviewEdits(extracted.map(q => q));
      setShowPdfPreview(true);
    } catch (err) {
      setPdfError(`Failed to read PDF: ${err.message}`);
    } finally {
      setPdfUploading(false);
    }
  }

  async function confirmPDFQuestions() {
    const qs = pdfPreviewEdits
      .map(q => q.trim())
      .filter(Boolean)
      .map(q => ({ question: q, type: 'text' }));
    if (qs.length === 0) { setPdfError('No questions to save.'); return; }
    setShowPdfPreview(false);
    setPdfPreview(null);
    await saveQuestions(qs);
    setStatus(`✅ ${qs.length} questions imported from PDF and saved!`);
  }

  // ── Send / Recall ─────────────────────────────────────────────────────────
  async function sendReview() {
    if (!selectedTech) return;
    if (questions.length === 0) { setStatus('❌ Add at least one question first.'); return; }
    setSending(true);
    setStatus('⏳ Sending review…');
    try {
      const key = selectedTech.toLowerCase();
      const payload = { questions, sentAt: new Date().toISOString(), sentBy: currentUser, techName: selectedTech };
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
      const key = selectedTech.toLowerCase();
      await saveGithubFile(`data/tech-reviews/pending/${key}.json`, null, `Recall review for ${selectedTech}`);
      setPending(null);
      setStatus('✅ Review recalled.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSending(false); }
  }

  async function saveMgrReview() {
    if (!selectedTech) return;
    setSavingMgr(true);
    setStatus('⏳ Saving manager review…');
    try {
      const key = selectedTech.toLowerCase();
      const reviewQuestions = submission?.questions || pending?.questions || questions;
      const payload = { answers: mgrAnswers, questions: reviewQuestions, savedBy: currentUser, savedAt: new Date().toISOString(), techName: selectedTech };
      await saveGithubFile(`data/tech-reviews/manager-reviews/${key}/latest.json`, payload, `Manager review for ${selectedTech}`);
      setMgrReview(payload);
      setStatus('✅ Manager review saved.');
    } catch(e) { setStatus(`❌ ${e.message}`); }
    finally { setSavingMgr(false); }
  }

  async function handleGenerateAI() {
    if (!selectedTech) return;
    if (!submission) { setAiError('Waiting for tech to submit their self-review first.'); return; }
    if (!mgrReview && mgrAnswers.every(a => !a)) { setAiError('Please save your manager review first.'); return; }
    if (!getOpenAIKey()) { setAiError('No OpenAI API key set. Go to Admin Settings to add it.'); return; }
    setGeneratingAI(true);
    setAiError('');
    try {
      const reviewQuestions = submission.questions || questions;
      const report = await generateReviewReport({
        techName: selectedTech,
        questions: reviewQuestions,
        techAnswers: submission.answers || [],
        managerAnswers: mgrReview?.answers || mgrAnswers,
      });
      const key = selectedTech.toLowerCase();
      const payload = { report, generatedAt: new Date().toISOString(), techName: selectedTech };
      await saveGithubFile(`data/tech-reviews/reports/${key}/latest.json`, payload, `AI report for ${selectedTech}`);
      setAiReport(payload);
      setStatus('✅ AI report generated and saved!');
    } catch(e) { setAiError(`❌ ${e.message}`); }
    finally { setGeneratingAI(false); }
  }

  // ── PDF Preview Modal ─────────────────────────────────────────────────────
  if (showPdfPreview) {
    return (
      <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="adv-topbar">
          <div>
            <div className="adv-title">📄 Review Extracted Questions</div>
            <div className="adv-sub">Edit or remove questions before saving</div>
          </div>
          <button className="secondary" onClick={() => { setShowPdfPreview(false); setPdfPreview(null); }}>✕ Cancel</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>

            <div style={{ background: 'linear-gradient(135deg,rgba(99,102,241,.12),rgba(79,70,229,.07))', border: '1px solid rgba(99,102,241,.3)', borderRadius: 14, padding: '16px 20px', marginBottom: 24 }}>
              <div style={{ fontWeight: 900, color: '#a5b4fc', fontSize: 15, marginBottom: 4 }}>📄 {pdfPreviewEdits.length} Question{pdfPreviewEdits.length !== 1 ? 's' : ''} Found</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>Review and edit the extracted questions below. Remove any that are not actual review questions. Click Save when ready.</div>
            </div>

            {pdfPreviewEdits.map((q, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, background: 'rgba(255,255,255,.04)', borderRadius: 10, padding: '12px 14px' }}>
                <span style={{ fontWeight: 900, color: '#fbbf24', fontSize: 12, minWidth: 28, marginTop: 3 }}>Q{i + 1}</span>
                <input
                  value={q}
                  onChange={e => {
                    const edits = [...pdfPreviewEdits];
                    edits[i] = e.target.value;
                    setPdfPreviewEdits(edits);
                  }}
                  style={{ ...inp, flex: 1 }}
                />
                <button
                  onClick={() => setPdfPreviewEdits(pdfPreviewEdits.filter((_, idx) => idx !== i))}
                  style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  ✕ Remove
                </button>
              </div>
            ))}

            {/* Add manual question in preview */}
            <div style={{ display: 'flex', gap: 10, marginTop: 8, marginBottom: 24 }}>
              <input
                placeholder="Add another question…"
                id="pdfAddQ"
                style={{ ...inp, flex: 1 }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    setPdfPreviewEdits([...pdfPreviewEdits, e.target.value.trim()]);
                    e.target.value = '';
                  }
                }}
              />
              <button
                onClick={() => {
                  const el = document.getElementById('pdfAddQ');
                  if (el?.value.trim()) { setPdfPreviewEdits([...pdfPreviewEdits, el.value.trim()]); el.value = ''; }
                }}
                style={btn('rgba(251,191,36,.2)', 'rgba(251,191,36,.5)', '#fbbf24')}>
                + Add
              </button>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={confirmPDFQuestions}
                disabled={savingQ}
                style={{ ...btn('rgba(74,222,128,.2)', 'rgba(74,222,128,.5)', '#4ade80'), flex: 1, padding: '13px 20px', fontSize: 15 }}>
                {savingQ ? '⏳ Saving…' : `✅ Save ${pdfPreviewEdits.filter(q => q.trim()).length} Questions`}
              </button>
              <button onClick={() => { setShowPdfPreview(false); setPdfPreview(null); }} style={btn('rgba(255,255,255,.06)', 'rgba(255,255,255,.12)', '#94a3b8')}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: Tech List ──────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="adv-topbar">
          <div>
            <div className="adv-title">🔧 Technician Reviews</div>
            <div className="adv-sub">Select a technician to manage their review</div>
          </div>
          <button className="secondary" onClick={onBack}>← Employee Review</button>
        </div>

        {showPreview && <ReviewPreview questions={questions} onClose={() => setShowPreview(false)} />}

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

          {/* Question Builder */}
          <div style={section}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>
              <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1 }}>📋 Review Questions</div>
              {questions.length > 0 && (
                <button
                  onClick={() => setShowPreview(true)}
                  style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.4)', color: '#fbbf24', borderRadius: 9, padding: '7px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  👁 Preview Review
                </button>
              )}
            </div>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              Upload a PDF review form and the questions will be extracted automatically — or add questions manually below.
            </p>

            {/* PDF Upload */}
            <div style={{ background: 'linear-gradient(135deg,rgba(99,102,241,.1),rgba(79,70,229,.06))', border: '2px dashed rgba(99,102,241,.4)', borderRadius: 12, padding: '20px 24px', marginBottom: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
              <div style={{ fontWeight: 900, color: '#a5b4fc', fontSize: 15, marginBottom: 6 }}>Upload Review PDF</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
                Upload any PDF with numbered questions and they'll be extracted automatically.<br />
                <span style={{ fontSize: 12, color: '#475569' }}>Supports: numbered lists (1. 2. 3.), Q1/Q2 format, bullet points, lines ending with ?</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                onChange={handlePDFUpload}
                style={{ display: 'none' }}
                id="review-pdf-upload"
              />
              <label
                htmlFor="review-pdf-upload"
                style={{ display: 'inline-block', background: 'rgba(99,102,241,.2)', border: '1px solid rgba(99,102,241,.5)', color: '#a5b4fc', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                {pdfUploading ? '⏳ Reading PDF…' : '📤 Choose PDF File'}
              </label>
              {questions.length > 0 && (
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>
                  Current: {questions.length} question{questions.length !== 1 ? 's' : ''} loaded — uploading a new PDF will replace them
                </div>
              )}
              {pdfError && <div style={{ color: '#f87171', fontSize: 13, marginTop: 10, fontWeight: 700 }}>{pdfError}</div>}
            </div>

            {loadingQ ? (
              <div style={{ color: '#64748b', fontSize: 13 }}>⏳ Loading questions…</div>
            ) : (
              <>
                {questions.length === 0 && (
                  <div style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>No questions yet. Upload a PDF above or add questions manually below.</div>
                )}
                {questions.map((q, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: 'rgba(255,255,255,.04)', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 900, minWidth: 24 }}>Q{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 13, color: '#e2e8f0' }}>{q.question}</span>
                    <button onClick={() => moveQuestion(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>↑</button>
                    <button onClick={() => moveQuestion(i, 1)} disabled={i === questions.length - 1} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>↓</button>
                    <button onClick={() => removeQuestion(i)} style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>✕ Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <input
                    value={newQ}
                    onChange={e => setNewQ(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addQuestion()}
                    placeholder="Or type a question manually and press Enter…"
                    style={{ ...inp, flex: 1 }}
                  />
                  <button onClick={addQuestion} disabled={savingQ || !newQ.trim()}
                    style={btn('rgba(251,191,36,.2)', 'rgba(251,191,36,.5)', '#fbbf24', { opacity: !newQ.trim() ? 0.5 : 1 })}>
                    {savingQ ? '⏳' : '+ Add'}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Tech List */}
          <div style={section}>
            <div style={sectionTitle}>👨‍🔧 Technicians</div>
            {!techList || techList.length === 0 ? (
              <div style={{ color: '#475569', fontSize: 14, textAlign: 'center', padding: 20 }}>No technicians found. Make sure users have the "technician" role set in Admin Settings.</div>
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

  // ── RENDER: Individual Tech ────────────────────────────────────────────────
  const reviewQuestions = submission?.questions || pending?.questions || questions;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">🔧 {selectedTech} — Review</div>
          <div className="adv-sub">Performance Review Management</div>
        </div>
        <button className="secondary" onClick={() => { setView('list'); setSelectedTech(null); setStatus(''); }}>← All Technicians</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        {loadingTech ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>⏳ Loading review data…</div>
        ) : (
          <>
            {/* Status badges */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              {[
                { label: 'Review Sent', done: !!pending, icon: '📤' },
                { label: 'Tech Submitted', done: !!submission, icon: '✍️' },
                { label: 'Manager Review', done: !!mgrReview, icon: '📝' },
                { label: 'AI Report', done: !!aiReport, icon: '🤖' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, background: s.done ? 'rgba(74,222,128,.1)' : 'rgba(255,255,255,.05)', border: `1px solid ${s.done ? 'rgba(74,222,128,.3)' : 'rgba(255,255,255,.1)'}`, borderRadius: 20, padding: '4px 14px' }}>
                  <span>{s.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: s.done ? '#4ade80' : '#64748b' }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: s.done ? '#4ade80' : '#475569' }}>{s.done ? '✓' : '○'}</span>
                </div>
              ))}
            </div>

            {/* Send / Recall Review */}
            <div style={section}>
              <div style={sectionTitle}>📤 Send Review to Tech</div>
              {pending ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 20 }}>📨</span>
                    <div>
                      <div style={{ fontWeight: 700, color: '#4ade80', fontSize: 13 }}>Review is currently active</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>Sent {new Date(pending.sentAt).toLocaleString()} by {pending.sentBy}</div>
                    </div>
                  </div>
                  {!submission && (
                    <button onClick={recallReview} disabled={sending}
                      style={btn('rgba(239,68,68,.15)', 'rgba(239,68,68,.4)', '#f87171')}>
                      {sending ? '⏳ Recalling…' : '↩ Recall Review'}
                    </button>
                  )}
                  {submission && <div style={{ fontSize: 12, color: '#64748b' }}>Tech has already submitted — cannot recall.</div>}
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
                    Sending will push {questions.length} question{questions.length !== 1 ? 's' : ''} to {selectedTech}'s Technician Resources page. They will see a "My Review" tab to complete.
                  </p>
                  {questions.length === 0 ? (
                    <div style={{ color: '#f87171', fontSize: 13 }}>⚠️ Go back and add questions or upload a PDF before sending.</div>
                  ) : (
                    <button onClick={sendReview} disabled={sending}
                      style={btn('rgba(74,222,128,.2)', 'rgba(74,222,128,.5)', '#4ade80')}>
                      {sending ? '⏳ Sending…' : `📤 Send Review to ${selectedTech}`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Tech's Self-Review (read-only) */}
            {submission && (
              <div style={section}>
                <div style={sectionTitle}>✍️ {selectedTech}'s Self-Review</div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Submitted {new Date(submission.submittedAt).toLocaleString()}</div>
                {(submission.questions || questions).map((q, i) => (
                  <div key={i} style={{ marginBottom: 16, background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#fbbf24', marginBottom: 4 }}>Q{i + 1}: {q.question || q}</div>
                    <div style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{submission.answers?.[i] || <span style={{ color: '#475569' }}>(no answer)</span>}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Manager's Review */}
            {(submission || pending) && (
              <div style={section}>
                <div style={sectionTitle}>📝 Your Manager Review</div>
                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Answer the same questions from your perspective as the manager.</p>
                {reviewQuestions.map((q, i) => (
                  <div key={i} style={{ marginBottom: 16 }}>
                    <label style={lbl}>Q{i + 1}: {q.question || q}</label>
                    <textarea
                      value={mgrAnswers[i] || ''}
                      onChange={e => { const a = [...mgrAnswers]; a[i] = e.target.value; setMgrAnswers(a); }}
                      rows={3}
                      style={{ ...inp, resize: 'vertical' }}
                      placeholder="Your assessment…"
                    />
                  </div>
                ))}
                <button onClick={saveMgrReview} disabled={savingMgr}
                  style={btn('rgba(139,92,246,.2)', 'rgba(139,92,246,.5)', '#c4b5fd')}>
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
                    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '16px 20px', fontSize: 14, color: '#e2e8f0', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                      {aiReport.report}
                    </div>
                    <button onClick={handleGenerateAI} disabled={generatingAI} style={{ ...btn('rgba(251,191,36,.2)', 'rgba(251,191,36,.5)', '#fbbf24'), marginTop: 12 }}>
                      {generatingAI ? '⏳ Regenerating…' : '🔄 Regenerate Report'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
                      {!submission ? '⏳ Waiting for tech to submit their self-review.' : !mgrReview ? '⚠️ Save your manager review above first.' : '✅ Both reviews ready — generate the AI report below.'}
                    </p>
                    {aiError && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{aiError}</div>}
                    {!getOpenAIKey() && (
                      <div style={{ color: '#fbbf24', fontSize: 12, marginBottom: 12 }}>⚠️ No OpenAI API key set. Go to Admin Settings to add it.</div>
                    )}
                    <button
                      onClick={handleGenerateAI}
                      disabled={generatingAI || !submission || !getOpenAIKey()}
                      style={btn('rgba(251,191,36,.2)', 'rgba(251,191,36,.5)', '#fbbf24', { opacity: (!submission || !getOpenAIKey()) ? 0.5 : 1 })}>
                      {generatingAI ? '⏳ Generating Report…' : '🤖 Generate AI Report'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Status */}
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
