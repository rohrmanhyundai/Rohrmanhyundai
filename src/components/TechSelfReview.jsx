import React, { useState, useEffect } from 'react';
import { loadGithubFile, saveGithubFile } from '../utils/github';
import ReviewFormRenderer, { validateReviewForm } from './ReviewFormRenderer';

export default function TechSelfReview({ currentUser, onBack }) {
  const [loading, setLoading]       = useState(true);
  const [formDef, setFormDef]       = useState(null);
  const [values, setValues]         = useState({});
  const [submitted, setSubmitted]   = useState(false);
  const [submittedData, setSubmittedData] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus]         = useState('');
  const [pendingDueDate, setPendingDueDate] = useState(null);
  const [showErrors, setShowErrors]         = useState(false);

  const validation = validateReviewForm(formDef, values);

  const key = currentUser.toLowerCase();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadGithubFile(`data/tech-reviews/pending/${key}.json`).catch(() => null),
      loadGithubFile(`data/tech-reviews/submissions/${key}/latest.json`).catch(() => null),
    ]).then(([pending, sub]) => {
      if (sub) {
        // Already submitted — show read-only view
        setSubmitted(true);
        setFormDef(sub.formDef || null);
        setValues(sub.values || {});
        setSubmittedData(sub);
      } else if (pending && pending.formDef) {
        setFormDef(pending.formDef);
        setValues({});
        if (pending.dueDate) setPendingDueDate(pending.dueDate);
      } else {
        setFormDef(null);
      }
    }).finally(() => setLoading(false));
  }, [key]);

  async function handleSubmit() {
    if (!formDef) return;
    if (!validation.valid) {
      setShowErrors(true);
      setStatus(`❌ Please complete all ${validation.summary.length} highlighted question${validation.summary.length === 1 ? '' : 's'} before submitting.`);
      return;
    }
    if (!window.confirm('Submit your review? You cannot make changes after submitting.')) return;
    setSubmitting(true);
    setStatus('⏳ Submitting…');
    try {
      const payload = {
        techName: currentUser,
        formDef,
        values,
        submittedAt: new Date().toISOString(),
      };
      await saveGithubFile(
        `data/tech-reviews/submissions/${key}/latest.json`,
        payload,
        `Tech self-review submitted by ${currentUser}`
      );
      // Clear pending
      await saveGithubFile(
        `data/tech-reviews/pending/${key}.json`,
        null,
        `Clear pending review for ${currentUser}`
      );
      setSubmitted(true);
      setSubmittedData(payload);
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#64748b', fontSize: 16 }}>⏳ Loading your review…</div>

          ) : !formDef ? (
            <div style={{ textAlign: 'center', padding: 80 }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>📋</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: '#94a3b8', marginBottom: 8 }}>No Review Pending</div>
              <div style={{ fontSize: 14, color: '#475569' }}>Your manager has not sent you a review yet. Check back later.</div>
            </div>

          ) : submitted ? (
            <div>
              {/* Submitted banner */}
              <div style={{ background: 'linear-gradient(135deg,rgba(74,222,128,.12),rgba(34,197,94,.07))', border: '1px solid rgba(74,222,128,.3)', borderRadius: 16, padding: '22px 26px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 18 }}>
                <div style={{ fontSize: 40 }}>✅</div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 17, color: '#4ade80', marginBottom: 4 }}>Review Submitted</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>
                    Submitted {submittedData?.submittedAt ? new Date(submittedData.submittedAt).toLocaleString() : ''}. Your manager will review your answers.
                  </div>
                </div>
              </div>
              {/* Read-only form */}
              <ReviewFormRenderer formDef={formDef} values={values} readOnly />
            </div>

          ) : (
            <div>
              {/* Due date banner */}
              {pendingDueDate && (() => {
                const due = new Date(pendingDueDate);
                const daysLeft = Math.ceil((due - Date.now()) / 86400000);
                const overdue = daysLeft < 0;
                const urgent = !overdue && daysLeft <= 2;
                const bg = overdue ? 'rgba(239,68,68,.1)' : urgent ? 'rgba(251,191,36,.1)' : 'rgba(59,130,246,.08)';
                const border = overdue ? 'rgba(239,68,68,.4)' : urgent ? 'rgba(251,191,36,.35)' : 'rgba(59,130,246,.25)';
                const color = overdue ? '#f87171' : urgent ? '#fbbf24' : '#60a5fa';
                return (
                  <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: '14px 20px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ fontSize: 26 }}>{overdue ? '⚠️' : urgent ? '⏰' : '📅'}</span>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 14, color }}>
                        {overdue
                          ? `Review Overdue by ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''}`
                          : daysLeft === 0
                          ? 'Review Due Today!'
                          : `${daysLeft} Day${daysLeft !== 1 ? 's' : ''} Left to Complete`}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Due date: {due.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Instructions banner */}
              <div style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.1),rgba(245,158,11,.06))', border: '1px solid rgba(251,191,36,.3)', borderRadius: 14, padding: '18px 22px', marginBottom: 26 }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: '#fbbf24', marginBottom: 5 }}>📋 Performance Self-Review</div>
                <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
                  Please answer each question honestly and thoroughly. Your manager will read your responses and complete their own evaluation. Once you submit, you cannot make changes.
                </div>
              </div>

              {/* Dynamic form */}
              <ReviewFormRenderer formDef={formDef} values={values} onChange={setValues} readOnly={false} errorsById={validation.errorsById} showErrors={showErrors} />

              {/* Status */}
              {status && (
                <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, background: status.startsWith('✅') ? 'rgba(74,222,128,.1)' : 'rgba(239,68,68,.1)', border: `1px solid ${status.startsWith('✅') ? 'rgba(74,222,128,.3)' : 'rgba(239,68,68,.3)'}`, color: status.startsWith('✅') ? '#4ade80' : '#f87171', fontSize: 13, fontWeight: 700 }}>
                  {status}
                </div>
              )}

              {/* Submit */}
              {showErrors && !validation.valid && (
                <div style={{ marginTop: 12, marginBottom: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.35)', color: '#f87171', fontSize: 13, fontWeight: 700 }}>
                  ⚠ {validation.summary.length} question{validation.summary.length === 1 ? '' : 's'} still need attention. Scroll up — they're highlighted in red.
                </div>
              )}
              <button
                onClick={handleSubmit}
                disabled={submitting || !validation.valid}
                title={!validation.valid ? 'Answer every question (and meet the minimum length on text answers) before submitting.' : ''}
                style={{
                  background: validation.valid ? 'linear-gradient(135deg,rgba(74,222,128,.25),rgba(34,197,94,.15))' : 'rgba(255,255,255,.04)',
                  border: `2px solid ${validation.valid ? 'rgba(74,222,128,.5)' : 'rgba(255,255,255,.12)'}`,
                  color: validation.valid ? '#4ade80' : '#475569',
                  borderRadius: 12, padding: '14px 32px',
                  cursor: validation.valid && !submitting ? 'pointer' : 'not-allowed',
                  fontWeight: 900, fontSize: 15, width: '100%', marginTop: 12,
                  opacity: submitting ? 0.6 : 1,
                }}>
                {submitting ? '⏳ Submitting…' : validation.valid ? '✅ Submit My Review' : `🔒 Complete all ${validation.summary.length} remaining question${validation.summary.length === 1 ? '' : 's'} to submit`}
              </button>
              <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', marginTop: 8 }}>Once submitted you cannot make changes.</div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
