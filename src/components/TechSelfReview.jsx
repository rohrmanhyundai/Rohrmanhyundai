import React, { useState, useEffect } from 'react';
import { loadGithubFile, saveGithubFile } from '../utils/github';

const inp = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 };
const section = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 };

export default function TechSelfReview({ currentUser, onBack }) {
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null);      // pending review payload
  const [answers, setAnswers] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');

  const key = currentUser.toLowerCase();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadGithubFile(`data/tech-reviews/pending/${key}.json`).catch(() => null),
      loadGithubFile(`data/tech-reviews/submissions/${key}/latest.json`).catch(() => null),
    ]).then(([pending, sub]) => {
      if (sub) {
        // Already submitted — show submitted state
        setSubmitted(true);
        setReview(sub);
        setAnswers(sub.answers || []);
      } else if (pending) {
        setReview(pending);
        setAnswers((pending.questions || []).map(() => ''));
      } else {
        setReview(null);
      }
    }).finally(() => setLoading(false));
  }, [key]);

  async function handleSubmit() {
    if (!review) return;
    const unanswered = answers.filter(a => !a.trim()).length;
    if (unanswered > 0) {
      if (!window.confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`)) return;
    }
    setSubmitting(true);
    setStatus('⏳ Submitting…');
    try {
      const payload = {
        techName: currentUser,
        questions: review.questions,
        answers,
        submittedAt: new Date().toISOString(),
      };
      await saveGithubFile(
        `data/tech-reviews/submissions/${key}/latest.json`,
        payload,
        `Tech self-review submitted by ${currentUser}`
      );
      // Remove from pending
      await saveGithubFile(
        `data/tech-reviews/pending/${key}.json`,
        null,
        `Clear pending review for ${currentUser}`
      );
      setSubmitted(true);
      setReview(payload);
      setStatus('✅ Review submitted successfully!');
    } catch (e) {
      setStatus(`❌ ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">📋 My Performance Review</div>
          <div className="adv-sub">{currentUser}</div>
        </div>
        <button className="secondary" onClick={onBack}>← Technician Resources</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#64748b', fontSize: 16 }}>⏳ Loading your review…</div>
          ) : !review && !submitted ? (
            <div style={{ textAlign: 'center', padding: 80 }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>📋</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: '#94a3b8', marginBottom: 8 }}>No Review Pending</div>
              <div style={{ fontSize: 14, color: '#475569' }}>Your manager has not sent you a review yet. Check back later.</div>
            </div>
          ) : submitted ? (
            <div>
              {/* Submitted banner */}
              <div style={{ background: 'linear-gradient(135deg,rgba(74,222,128,.12),rgba(34,197,94,.07))', border: '1px solid rgba(74,222,128,.3)', borderRadius: 16, padding: '24px 28px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 18 }}>
                <div style={{ fontSize: 44 }}>✅</div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 18, color: '#4ade80', marginBottom: 4 }}>Review Submitted</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>
                    Submitted {review.submittedAt ? new Date(review.submittedAt).toLocaleString() : ''}. Your manager will review your answers.
                  </div>
                </div>
              </div>

              {/* Show answers read-only */}
              <div style={section}>
                <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,.1)', paddingBottom: 8 }}>
                  Your Answers
                </div>
                {(review.questions || []).map((q, i) => (
                  <div key={i} style={{ marginBottom: 18, background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#fbbf24', marginBottom: 6 }}>Q{i + 1}: {q.question || q}</div>
                    <div style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {review.answers?.[i] || <span style={{ color: '#475569', fontStyle: 'italic' }}>(no answer provided)</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              {/* Instructions banner */}
              <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.1),rgba(245,158,11,.06))', border: '1px solid rgba(251,191,36,.3)', borderRadius: 14, padding: '20px 24px', marginBottom: 28 }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: '#fbbf24', marginBottom: 6 }}>📋 Performance Self-Review</div>
                <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
                  Please answer each question honestly and thoroughly. Your manager will read your responses and complete their own evaluation. Once you submit, you cannot make changes.
                </div>
                {review.sentAt && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                    Sent by {review.sentBy} on {new Date(review.sentAt).toLocaleDateString()}
                  </div>
                )}
              </div>

              {/* Questions */}
              {(review.questions || []).map((q, i) => (
                <div key={i} style={{ marginBottom: 22 }}>
                  <label style={lbl}>Question {i + 1} of {review.questions.length}</label>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>{q.question || q}</div>
                  <textarea
                    value={answers[i] || ''}
                    onChange={e => {
                      const a = [...answers];
                      a[i] = e.target.value;
                      setAnswers(a);
                    }}
                    rows={4}
                    placeholder="Type your answer here…"
                    style={{ ...inp, resize: 'vertical' }}
                  />
                </div>
              ))}

              {status && (
                <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : 'rgba(239,68,68,.1)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : 'rgba(239,68,68,.3)'}`, color: status.startsWith('✅') ? '#4ade80' : '#f87171', fontSize: 13, fontWeight: 700 }}>
                  {status}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{ background: 'linear-gradient(135deg,rgba(74,222,128,.25),rgba(34,197,94,.15))', border: '2px solid rgba(74,222,128,.5)', color: '#4ade80', borderRadius: 12, padding: '14px 32px', cursor: 'pointer', fontWeight: 900, fontSize: 15, width: '100%' }}
              >
                {submitting ? '⏳ Submitting…' : '✅ Submit My Review'}
              </button>
              <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', marginTop: 8 }}>Once submitted you cannot make changes.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
