import React, { useState, useEffect } from 'react';
import { loadUsers, saveUsers, requestPasswordReset } from '../utils/github';
import { checkResetToken, withPassword, passwordProblem } from '../utils/password';
import * as api from '../utils/api';
import { trackAction } from '../utils/activityTracker';

// ── Shared bits ───────────────────────────────────────────────────────────────
const card = { width: '100%', maxWidth: 440, background: '#0f172a', border: '1px solid rgba(96,165,250,.3)', borderRadius: 16, padding: 26, boxShadow: '0 24px 70px rgba(0,0,0,.55)' };
const inputStyle = { width: '100%', background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 10, padding: '11px 13px', fontSize: 15, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' };
const labelStyle = { display: 'block', fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 };
const Overlay = ({ children, onClose }) => (
  <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16 }}>
    <div onClick={e => e.stopPropagation()} style={card}>{children}</div>
  </div>
);

function PasswordPair({ pw, setPw, pw2, setPw2, autoFocus }) {
  const problem = pw ? passwordProblem(pw) : '';
  const mismatch = pw2 && pw !== pw2;
  return (
    <>
      <label style={labelStyle}>New password</label>
      <input type="password" autoFocus={autoFocus} autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} style={inputStyle} />
      {problem && <div style={{ color: '#fbbf24', fontSize: 12, marginTop: 5 }}>{problem}</div>}
      <label style={{ ...labelStyle, marginTop: 14 }}>Confirm new password</label>
      <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} style={inputStyle} />
      {mismatch && <div style={{ color: '#fbbf24', fontSize: 12, marginTop: 5 }}>Passwords don't match.</div>}
    </>
  );
}

// The worker has just accepted a new password (and given us pwSalt for it):
// refresh the user's record in users.json — vault copy, pwSalt marker, any
// pending reset cleared. Fresh copy from GitHub so a stale local list can't
// clobber someone else's changes. Best effort: the password already works.
async function recordNewPassword(username, password, pwSalt) {
  try {
    const loaded = await loadUsers();
    const users = (loaded && loaded.users) || [];
    const idx = users.findIndex(u => (u.username || '').toUpperCase() === String(username || '').toUpperCase());
    if (idx < 0) return;
    users[idx] = await withPassword(users[idx], password, loaded.passwordVault, pwSalt);
    await saveUsers(users);
  } catch (e) { console.warn('could not update the user record after a password change', e); }
}

// ── Reset page — opened from the emailed link (?reset=TOKEN&u=USERNAME) ───────
export function ResetPasswordPage({ token, username, onDone }) {
  const [state, setState] = useState('checking'); // checking | ready | invalid | saving | done
  const [reason, setReason] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadUsers();
        const u = (loaded && loaded.users || []).find(x => (x.username || '').toUpperCase() === String(username || '').toUpperCase());
        const res = u ? await checkResetToken(u, token) : { ok: false, reason: 'none' };
        if (cancelled) return;
        if (res.ok) setState('ready'); else { setState('invalid'); setReason(res.reason); }
      } catch { if (!cancelled) { setState('invalid'); setReason('error'); } }
    })();
    return () => { cancelled = true; };
  }, [token, username]);

  async function save() {
    const problem = passwordProblem(pw);
    if (problem) { setErr(problem); return; }
    if (pw !== pw2) { setErr("Passwords don't match."); return; }
    setErr(''); setState('saving');
    try {
      // The worker checks the link again itself (single use) and, on success,
      // signs this browser in so the record can be updated.
      const r = await api.resetPassword(username, token, pw);
      await recordNewPassword(username, pw, r.pwSalt);
      api.logout();
      trackAction('password-reset-complete');
      setState('done');
    } catch (e) { setErr(e?.message || String(e)); setState('ready'); }
  }

  const why = { none: "This link isn't valid — it may have been used already.", expired: 'This link has expired (they last one hour).', mismatch: "This link doesn't match the latest reset request — use the newest email.", error: 'Could not reach the user list. Try again in a minute.' }[reason] || 'This link is not valid.';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(circle at 20% 0%, rgba(61,214,195,.18), transparent 35%), radial-gradient(circle at 100% 100%, rgba(139,92,246,.2), transparent 40%), #050b13', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1100 }}>
      <div style={card}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.16em', textTransform: 'uppercase', color: '#67e8f9' }}>Rohrman Hyundai · Service</div>
        <div style={{ fontSize: 24, fontWeight: 1000, color: '#fff', margin: '8px 0 4px' }}>
          {state === 'done' ? '✅ Password updated' : '🔑 Choose a new password'}
        </div>
        <div style={{ fontSize: 13.5, color: '#94a3b8', marginBottom: 18 }}>for <b style={{ color: '#e2e8f0' }}>{String(username || '').toUpperCase()}</b></div>

        {state === 'checking' && <div style={{ color: '#94a3b8' }}>⏳ Checking your link…</div>}
        {state === 'invalid' && (
          <>
            <div style={{ background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 10, padding: '12px 14px', color: '#fca5a5', fontSize: 13.5, lineHeight: 1.5 }}>{why}</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 14, lineHeight: 1.5 }}>Use <b>Forgot password?</b> on the login screen to get a fresh link.</div>
            <button onClick={onDone} style={{ marginTop: 18, width: '100%', padding: '11px', fontSize: 14 }}>Back to the dashboard</button>
          </>
        )}
        {(state === 'ready' || state === 'saving') && (
          <>
            <PasswordPair pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} autoFocus />
            {err && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 10 }}>{err}</div>}
            <button onClick={save} disabled={state === 'saving'} style={{ marginTop: 18, width: '100%', padding: '12px', fontSize: 15 }}>
              {state === 'saving' ? '⏳ Saving…' : 'Save new password'}
            </button>
          </>
        )}
        {state === 'done' && (
          <>
            <div style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.6 }}>You're all set. Log in with your new password.</div>
            <button onClick={onDone} style={{ marginTop: 18, width: '100%', padding: '12px', fontSize: 15 }}>Go to login</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Change password (logged in) ───────────────────────────────────────────────
export function ChangePasswordModal({ username, onClose }) {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  async function save() {
    const problem = passwordProblem(pw);
    if (problem) { setErr(problem); return; }
    if (pw !== pw2) { setErr("Passwords don't match."); return; }
    setErr(''); setBusy(true);
    try {
      const r = await api.changePassword(cur, pw);
      await recordNewPassword(username, pw, r.pwSalt);
      trackAction('password-changed');
      setDone(true);
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ fontSize: 20, fontWeight: 1000, color: '#fff', marginBottom: 2 }}>{done ? '✅ Password changed' : '🔑 Change password'}</div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>{String(username || '').toUpperCase()}</div>
      {done ? (
        <button onClick={onClose} style={{ width: '100%', padding: 11 }}>Done</button>
      ) : (
        <>
          <label style={labelStyle}>Current password</label>
          <input type="password" autoFocus autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} style={inputStyle} />
          <div style={{ height: 14 }} />
          <PasswordPair pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />
          {err && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button className="secondary" onClick={onClose} style={{ flex: 1, padding: 11 }}>Cancel</button>
            <button onClick={save} disabled={busy} style={{ flex: 2, padding: 11 }}>{busy ? '⏳ Saving…' : 'Save'}</button>
          </div>
        </>
      )}
    </Overlay>
  );
}

// ── Forgot password (logged out) ──────────────────────────────────────────────
export function ForgotPasswordModal({ initialUsername = '', onClose }) {
  const [name, setName] = useState(initialUsername);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  async function send() {
    if (!name.trim()) { setErr('Enter your username.'); return; }
    setErr(''); setBusy(true);
    try {
      await requestPasswordReset(name.trim());
      trackAction('password-reset-requested', { username: name.trim().toUpperCase() });
      setSent(true);
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ fontSize: 20, fontWeight: 1000, color: '#fff', marginBottom: 2 }}>{sent ? '📬 Check your email' : '🔑 Forgot password?'}</div>
      {sent ? (
        <>
          <div style={{ fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.6, marginTop: 10 }}>
            If <b>{name.trim().toUpperCase()}</b> has an email on file, a reset link is on its way — give it a minute or two and check spam. The link works for one hour.
          </div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 10 }}>No email yet? Ask a manager to add your email address to your user.</div>
          <button onClick={onClose} style={{ marginTop: 18, width: '100%', padding: 11 }}>OK</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>We'll email you a link to choose a new one.</div>
          <label style={labelStyle}>Username</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="e.g. david" style={inputStyle} />
          {err && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button className="secondary" onClick={onClose} style={{ flex: 1, padding: 11 }}>Cancel</button>
            <button onClick={send} disabled={busy} style={{ flex: 2, padding: 11 }}>{busy ? '⏳ Sending…' : 'Email me a reset link'}</button>
          </div>
        </>
      )}
    </Overlay>
  );
}
