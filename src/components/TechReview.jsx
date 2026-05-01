import React, { useState, useEffect } from 'react';
import { loadGithubFile, saveGithubFile, getGithubToken } from '../utils/github';
import { generateReviewReport, getOpenAIKey } from '../utils/openai';

const section = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 };
const sectionTitle = { fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 };
const inp = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };

function btn(bg, border, color, extra = {}) {
  return { background: bg, border: `1px solid ${border}`, color, borderRadius: 10, padding: '9px 20px', cursor: 'pointer', fontWeight: 800, fontSize: 13, ...extra };
}

export default function TechReview({ onBack, techList, currentUser }) {
  const [view, setView] = useState('list'); // 'list' | 'tech'
  const [selectedTech, setSelectedTech] = useState(null);

  // Questions management
  const [questions, setQuestions]   = useState([]);
  const [loadingQ, setLoadingQ]     = useState(true);
  const [newQ, setNewQ]             = useState('');
  const [savingQ, setSavingQ]       = useState(false);

  // Pending / submissions
  const [pending,      setPending]      = useState(null);  // pending review sent to this tech
  const [submission,   setSubmission]   = useState(null);  // tech's self-review
  const [mgrReview,    setMgrReview]    = useState(null);  // manager's review
  const [aiReport,     setAiReport]     = useState(null);  // AI report
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

  // ── RENDER: Tech List ──
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

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

          {/* Question Builder */}
          <div style={section}>
            <div style={sectionTitle}>📋 Review Questions</div>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              Build the questions that will be sent to technicians for their self-review. These questions will appear on their review form.
            </p>
            {loadingQ ? (
              <div style={{ color: '#64748b', fontSize: 13 }}>⏳ Loading questions…</div>
            ) : (
              <>
                {questions.length === 0 && (
                  <div style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>No questions yet. Add your first question below.</div>
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
                    placeholder="Type a new review question and press Enter or Add…"
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
            {techList.length === 0 ? (
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

  // ── RENDER: Individual Tech ──
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
                    <div style={{ color: '#f87171', fontSize: 13 }}>⚠️ Go back and add questions before sending.</div>
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
