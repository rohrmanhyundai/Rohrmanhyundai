import React, { useState, useEffect } from 'react';
import { verifyAccessCode, hasAccessCode } from '../utils/accessCode';
import { loadAccessLockouts, updateAccessLockouts, sendGlobalMessage } from '../utils/github';
import { triggerEvent, GLOBAL_CHANNEL, GLOBAL_MSG_EVENT } from '../utils/pusher';

// Wrong-code rules. 4 wrong → 5-minute lockout. 4 more wrong after that →
// locked out of every locked page until an admin clears it on the Access
// Codes screen, and every admin gets a message. A right code resets it all.
export const TRIES_PER_ROUND = 4;
export const LOCKOUT_MS = 5 * 60 * 1000;
const CODE_LEN = 4;

// ── Access codes ──────────────────────────────────────────────────────────────
// Any page can be put behind the user's 4-digit access code (set per user in
// Edit Dashboard → Users, stored hashed). An admin chooses, on the Access Codes
// screen, WHICH pages are locked and WHICH users may open each one.
//
// data/access-code.json: { updatedAt, by, locked: { [page]: true }, users: { [USERNAME]: { [page]: true } } }
//
// Until that file is saved the old behaviour holds exactly: Payroll and
// Employee Applicants are locked, and anyone who reaches them with a code set
// can open them.
//
// As with the original lock, this keeps the wrong person out of the screen on
// a shared terminal; it doesn't make the underlying data files private.

export const ACCESS_PATH = 'data/access-code.json';
export const DEFAULT_LOCKED = { payroll: true, 'employee-applicants': true };

// Every page in the app, grouped for the Access Codes screen. Keys are the
// App.jsx page names. The main dashboard is left out — locking it would lock
// everyone out of the site.
export const PAGE_GROUPS = [
  { group: 'Manager', pages: [
    ['manager-hub', 'Manager Hub'], ['user-management', 'User Management (Edit Dashboard)'], ['upload-reports', 'Upload Reports'], ['payroll', 'Payroll'],
    ['employee-applicants', 'Employee Applicants'], ['employee-review', 'Employee Review'], ['tech-review', 'Tech Review Forms'],
    ['advisor-review', 'Advisor Review'], ['mgr-performance-reports', 'Performance Reports (all advisors)'],
    ['goal-forecast', 'Goal Forecast'], ['advisor-goals', 'Advisor Forecast / End of Day Reporting'],
    ['cash-dash', 'Cash Dash'], ['big-money-lof', 'Big-Money LOF'], ['daily-wrench', 'The Daily Wrench'],
    ['global-message', 'Global Message'], ['user-data-tracker', 'User Data Tracker'], ['repair-order-database', 'Repair Order Database'],
    ['survey-reports', 'Survey Reports'],
  ] },
  { group: 'Pay', pages: [
    ['live-pay-hub', 'Live Pay'], ['live-pay', 'Advisor Live Pay'], ['tech-live-pay', 'Tech Live Pay'],
  ] },
  { group: 'Advisor', pages: [
    ['advisor-calendar', 'Appointment Prep Calendar'], ['advisor-day', 'Prep Sheet (a day)'], ['after-call', 'After Call Reviews'],
    ['deferred-service', 'Deferred Service'], ['ro-upload', 'RO Upload'], ['work-in-progress', 'Work in Progress'],
    ['performance-report', 'My Reports'], ['service-pricing', 'Service Pricing Menu'], ['tire-quote', 'Tire Quote'],
    ['document-library', 'Document Library'], ['charge-account-list', 'Charge Account List'], ['hot-repairs', 'Recalls/TSB Bulletins'],
    ['aftermarket-warranty', 'Aftermarket Warranty'], ['original-owner', 'Original Owner'], ['shop-appointments', 'Shop Appointments'],
  ] },
  { group: 'Parts · Warranty · Used Cars', pages: [
    ['parts-hub', 'Parts Hub'], ['parts-goal-forecast', 'Parts Goal Forecast'], ['warranty-hub', 'Warranty Hub'],
    ['used-car-hub', 'Used Car Hub'], ['tire-warranty', 'Tire Warranty'], ['registration-upload', 'Registration Upload'],
    ['registration-uploads', 'Registration Uploads (review)'], ['media-upload', 'Warranty Media Upload'],
  ] },
  { group: 'Technician', pages: [
    ['tech-resources', 'Technician Resources'], ['tech-self-review', 'Tech Self Review'], ['additional-time-menu', 'Additional Time'],
    ['additional-time', 'Additional Time Request'], ['additional-diag-time', 'Additional Diag Time'], ['additional-time-review', 'Additional Time Review'],
    ['at-diag-worksheet', 'AT Diag Worksheet'], ['atm-worksheet', 'ATM Worksheet'], ['ivt-worksheet', 'IVT Worksheet'],
    ['dct-mtm-worksheet', 'DCT / MTM Worksheet'], ['ntt-att-worksheet', 'NTT / ATT Worksheet'],
  ] },
];
export const PAGE_LABEL = Object.fromEntries(PAGE_GROUPS.flatMap(g => g.pages));

const up = (s) => String(s || '').trim().toUpperCase();

// cfg = the saved file, or null (never saved → the old Payroll/Applicants rule).
export function isLocked(cfg, page) {
  const locked = cfg ? (cfg.locked || {}) : DEFAULT_LOCKED;
  return !!locked[page];
}
export function mayOpen(cfg, page, username, role) {
  if (!cfg) return true;                                   // old rule: code alone decides
  if (role === 'admin') return true;                       // admins can always get in with their code
  return !!(cfg.users && cfg.users[up(username)] && cfg.users[up(username)][page]);
}

// Shown in place of a locked page: "no access", or the code prompt.
// `inline` = just the prompt card, for use inside another screen (Edit Dashboard).
export default function AccessGate({ page, allowed, currentUser, currentUserRecord, onUnlock, onBack, inline, admins = [] }) {
  const label = PAGE_LABEL[page] || page;
  const me = up(currentUser);
  const codeSet = hasAccessCode(currentUserRecord);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [checking, setChecking] = useState(false);
  const [lock, setLock] = useState({});          // this user's lockout record
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    loadAccessLockouts().then(d => { if (alive) setLock((d.users && d.users[me]) || {}); }).catch(() => {});
    return () => { alive = false; };
  }, [me]);
  const waiting = !lock.hard && lock.lockedUntil > now;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  async function notifyAdmins() {
    const to = (admins || []).map(up).filter(a => a && a !== me);
    if (!to.length) return;
    const entry = {
      id: `gm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      from: 'ACCESS CODES', to, alert: true, requireReply: false, replies: [], timestamp: Date.now(),
      text: `🔒 ${me} entered the wrong access code ${TRIES_PER_ROUND * 2} times (two rounds) trying to open ${label}, and is now locked out of every locked page until an admin clears it. `
        + `Fix: Edit Dashboard → Users → 🔐 Access Codes → Users → ${me} → Clear lockout (and reset their code in User Management if they've forgotten it).`,
    };
    try { await sendGlobalMessage(entry); await triggerEvent(GLOBAL_CHANNEL, GLOBAL_MSG_EVENT, entry); } catch {}
  }

  // One wrong code: count it on the site, apply the round / lockout rules.
  async function recordFail() {
    let rec = null, becameHard = false;
    try {
      const next = await updateAccessLockouts(users => {
        const r = { fails: 0, strikes: 0, ...(users[me] || {}) };
        becameHard = false;
        r.fails += 1; r.lastFailAt = Date.now(); r.page = page;
        if (r.fails >= TRIES_PER_ROUND) {
          r.fails = 0; r.strikes += 1;
          if (r.strikes >= 2) { becameHard = !r.hard; r.hard = true; r.hardAt = Date.now(); r.lockedUntil = 0; }
          else r.lockedUntil = Date.now() + LOCKOUT_MS;
        }
        users[me] = r;
      }, `Access code: wrong try (${me})`);
      rec = next.users[me];
    } catch {
      // Couldn't reach the site — still count it on this screen.
      rec = { ...lock, fails: (lock.fails || 0) + 1 };
      if (rec.fails >= TRIES_PER_ROUND) { rec.fails = 0; rec.strikes = (rec.strikes || 0) + 1; rec.lockedUntil = Date.now() + LOCKOUT_MS; }
    }
    setLock(rec); setNow(Date.now());
    if (becameHard) notifyAdmins();
    return rec;
  }

  async function submit(e, value) {
    e?.preventDefault?.();
    const v = String(value != null ? value : code).trim();
    if (!v || checking || lock.hard || waiting) return;
    setChecking(true); setErr('');
    try {
      const ok = await verifyAccessCode(v, currentUserRecord?.applicantCode);
      if (ok) {
        if (lock.fails || lock.strikes || lock.lockedUntil) updateAccessLockouts(users => { delete users[me]; }, `Access code: unlocked (${me})`).catch(() => {});
        onUnlock();
        return;
      }
      setCode('');
      const r = await recordFail();
      if (r.hard) setErr('');
      else if (r.lockedUntil > Date.now()) setErr('');
      else {
        const left = TRIES_PER_ROUND - (r.fails || 0);
        setErr(`Wrong code — ${left} ${left === 1 ? 'try' : 'tries'} left before ${r.strikes ? "you're locked out until an admin clears it" : 'a 5-minute lockout'}.`);
      }
    } catch { setErr('Could not check the code on this device.'); }
    finally { setChecking(false); }
  }
  const mmss = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  const input = { width: '100%', background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 10, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' };
  const card = (
        <form onSubmit={submit} style={{ width: '100%', maxWidth: 400, textAlign: 'center', border: '1px solid rgba(148,163,184,.22)', borderRadius: 18, padding: '34px 28px', background: 'linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015))' }}>
          <div style={{ fontSize: 40 }}>{allowed ? '🔒' : '⛔'}</div>
          {!allowed ? (
            <>
              <div style={{ fontSize: 19, fontWeight: 900, color: '#e8f1ff', marginTop: 12 }}>No access</div>
              <div style={{ fontSize: 13.5, color: '#fdba74', marginTop: 10, lineHeight: 1.65 }}>
                {label} is locked, and your login hasn't been given access to it. An admin can add it for you on the <strong>Access Codes</strong> screen.
              </div>
            </>
          ) : codeSet && lock.hard ? (
            <>
              <div style={{ fontSize: 19, fontWeight: 900, color: '#fecaca', marginTop: 12 }}>Locked out</div>
              <div style={{ fontSize: 13.5, color: '#fca5a5', marginTop: 10, lineHeight: 1.65 }}>
                Too many wrong codes. You're locked out of every locked page until an admin clears it — they've been sent a message.
              </div>
            </>
          ) : codeSet && waiting ? (
            <>
              <div style={{ fontSize: 19, fontWeight: 900, color: '#fde68a', marginTop: 12 }}>Too many wrong codes</div>
              <div style={{ fontSize: 13.5, color: '#fcd34d', marginTop: 10, lineHeight: 1.6 }}>Try again in</div>
              <div style={{ fontSize: 40, fontWeight: 1000, color: '#fef3c7', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{mmss(lock.lockedUntil - now)}</div>
              <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8, lineHeight: 1.5 }}>
                {TRIES_PER_ROUND} more wrong codes after this and you'll be locked out until an admin clears it.
              </div>
            </>
          ) : codeSet ? (
            <>
              <div style={{ fontSize: 19, fontWeight: 900, color: '#e8f1ff', marginTop: 12 }}>Enter your code</div>
              <div style={{ fontSize: 13, color: '#8296b4', marginTop: 8, lineHeight: 1.6 }}>{label} is locked. Enter your 4-digit access code — it opens as soon as it's right.</div>
              <input autoFocus value={code} disabled={checking}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setCode(v); setErr('');
                  if (v.length === CODE_LEN) submit(null, v);   // opens by itself on the 4th digit
                }}
                type="password" inputMode="numeric" placeholder="••••" autoComplete="off"
                style={{ ...input, marginTop: 18, textAlign: 'center', fontSize: 24, letterSpacing: '.5em', padding: 12 }} />
              {code.length > CODE_LEN && !checking && (
                <button type="submit" style={{ marginTop: 14, width: '100%', padding: 10, fontSize: 14, fontWeight: 800, background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.45)', color: '#93c5fd', borderRadius: 10 }}>Unlock</button>
              )}
              {checking && <div style={{ color: '#93c5fd', fontSize: 12.5, fontWeight: 700, marginTop: 10 }}>Checking…</div>}
              {err && <div style={{ color: '#fca5a5', fontSize: 12.5, fontWeight: 700, marginTop: 10 }}>⚠ {err}</div>}
              {!err && (lock.fails > 0 || lock.strikes > 0) && !checking && (
                <div style={{ color: '#fcd34d', fontSize: 12, fontWeight: 700, marginTop: 10 }}>
                  {TRIES_PER_ROUND - (lock.fails || 0)} tries left{lock.strikes ? ' before an admin has to unlock you' : ''}.
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 19, fontWeight: 900, color: '#e8f1ff', marginTop: 12 }}>You need a code</div>
              <div style={{ fontSize: 13.5, color: '#fdba74', marginTop: 10, lineHeight: 1.7 }}>
                {label} is locked and you don't have an access code yet. An admin sets one in <strong>Edit Dashboard → Users → Access Code</strong>.
              </div>
            </>
          )}
        </form>
  );
  if (inline) return <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 12px' }}>{card}</div>;
  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div><div className="adv-title">🔒 {label}</div><div className="adv-sub">{up(currentUser)}</div></div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px' }}>
        {card}
      </div>
    </div>
  );
}
